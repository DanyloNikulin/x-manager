//! Per-format writing skills: `skills/x-content-operator/formats/<post|thread|reply>.md`.
//!
//! Each file is a small skill of its own: a frontmatter with the character budget the
//! worker enforces, followed by the guidance that goes verbatim into the writer and the
//! validator prompts. The numbers live in the file so the prompt and the check can never
//! disagree; the worker measures, the models never have to count.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;

use crate::{models::ContentCandidate, worker::read_bounded};

/// X counts every http(s) URL as a fixed 23 characters, whatever its length.
pub const URL_WEIGHT: usize = 23;
const FORMATS_DIR: &str = "../skills/x-content-operator/formats";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    Post,
    Thread,
    Reply,
}

impl Format {
    /// `reply` tasks use the reply skill; `post` tasks use the thread skill when the
    /// planner asked for one and the post skill otherwise.
    pub fn for_task(task_type: &str, is_thread: bool) -> Self {
        match task_type {
            "reply" => Self::Reply,
            "post" if is_thread => Self::Thread,
            _ => Self::Post,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Post => "post",
            Self::Thread => "thread",
            Self::Reply => "reply",
        }
    }

    pub fn skill_path(self, config_root: &Path) -> PathBuf {
        config_root
            .join(FORMATS_DIR)
            .join(format!("{}.md", self.name()))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FormatSpec {
    pub format: Format,
    /// The skill body without its frontmatter; injected into the prompts.
    #[serde(skip)]
    pub guidance: String,
    pub max_weighted_chars: usize,
    /// Working floor; 0 means the format has no minimum (replies).
    pub min_weighted_chars: usize,
}

impl FormatSpec {
    pub async fn load(config_root: &Path, format: Format) -> Result<Self> {
        let path = format.skill_path(config_root);
        let raw = read_bounded(&path).await?;
        Self::parse(format, &raw)
            .with_context(|| format!("invalid format skill {}", path.display()))
    }

    pub fn parse(format: Format, raw: &str) -> Result<Self> {
        let (fields, body) = split_frontmatter(raw)?;
        let field = |key: &str| -> Result<&str> {
            fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.as_str())
                .with_context(|| format!("frontmatter is missing `{key}`"))
        };
        let name = field("name")?;
        if name != format.name() {
            bail!(
                "frontmatter name `{name}` does not match format `{}`",
                format.name()
            );
        }
        let max_weighted_chars: usize = field("max_weighted_chars")?
            .parse()
            .context("`max_weighted_chars` must be an integer")?;
        let min_weighted_chars: usize = field("min_weighted_chars")?
            .parse()
            .context("`min_weighted_chars` must be an integer")?;
        if max_weighted_chars == 0 || max_weighted_chars > 25_000 {
            bail!("`max_weighted_chars` must be between 1 and 25000");
        }
        if min_weighted_chars > max_weighted_chars {
            bail!("`min_weighted_chars` must not exceed `max_weighted_chars`");
        }
        if body.trim().is_empty() {
            bail!("the skill body is empty");
        }
        Ok(Self {
            format,
            guidance: body.trim().to_owned(),
            max_weighted_chars,
            min_weighted_chars,
        })
    }

    /// One line for the prompts, e.g. `post: 200 to 280 weighted characters per unit (...)`.
    pub fn band(&self) -> String {
        if self.min_weighted_chars == 0 {
            format!(
                "{}: at most {} weighted characters, no minimum (a URL counts as {URL_WEIGHT})",
                self.format.name(),
                self.max_weighted_chars
            )
        } else {
            format!(
                "{}: {} to {} weighted characters per unit (a URL counts as {URL_WEIGHT})",
                self.format.name(),
                self.min_weighted_chars,
                self.max_weighted_chars
            )
        }
    }

    /// Measures what the worker would publish for this format: every tweet of a thread,
    /// otherwise the text. The units follow the format, not the candidate: a post that
    /// came back as a thread, or a thread that came back as one post, is a shape defect
    /// and never within the band.
    ///
    /// The strings measured are the strings published: the worker submits `text.trim()`
    /// for a post or reply and the trimmed tweets of `thread_tweets` for a thread.
    pub fn check(&self, candidate: &ContentCandidate) -> LengthReport {
        let tweets = candidate.thread_tweets();
        let text_unit = || {
            (
                self.format.name().to_owned(),
                weighted_len(candidate.text.trim()),
            )
        };
        let (units, shape_issue): (Vec<(String, usize)>, Option<String>) = match self.format {
            Format::Thread if tweets.len() >= 2 => (
                tweets
                    .iter()
                    .enumerate()
                    .map(|(index, tweet)| (format!("tweet {}", index + 1), weighted_len(tweet)))
                    .collect(),
                None,
            ),
            Format::Thread => (
                vec![text_unit()],
                Some(format!(
                    "the thread format needs at least 2 non-empty tweets in `tweets` (got {} non-empty); every tweet goes into `tweets` in order and the first is repeated in `text`.",
                    candidate.tweets.iter().filter(|tweet| !tweet.trim().is_empty()).count()
                )),
            ),
            Format::Post | Format::Reply => (
                vec![text_unit()],
                (!tweets.is_empty()).then(|| {
                    format!(
                        "the {} format is a single `text`; `tweets` must stay empty (got {} tweets).",
                        self.format.name(),
                        tweets.len()
                    )
                }),
            ),
        };
        let measurements = units
            .into_iter()
            .map(|(label, weighted)| Measurement {
                over_limit: weighted > self.max_weighted_chars,
                under_floor: weighted < self.min_weighted_chars,
                label,
                weighted,
            })
            .collect();
        LengthReport {
            band: self.band(),
            max_weighted_chars: self.max_weighted_chars,
            min_weighted_chars: self.min_weighted_chars,
            measurements,
            shape_issue,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Measurement {
    pub label: String,
    pub weighted: usize,
    pub over_limit: bool,
    pub under_floor: bool,
}

/// What the worker measured, for the audit, the validator prompt and the revision round.
#[derive(Debug, Clone, Serialize)]
pub struct LengthReport {
    pub band: String,
    pub max_weighted_chars: usize,
    pub min_weighted_chars: usize,
    pub measurements: Vec<Measurement>,
    /// Set when the candidate has the wrong shape for the format (a post returned as a
    /// thread, a thread returned as one post); such a candidate is never within the band.
    pub shape_issue: Option<String>,
}

impl LengthReport {
    pub fn any_over_limit(&self) -> bool {
        self.measurements.iter().any(|m| m.over_limit)
    }

    pub fn any_under_floor(&self) -> bool {
        self.measurements.iter().any(|m| m.under_floor)
    }

    pub fn within_band(&self) -> bool {
        self.shape_issue.is_none() && !self.any_over_limit() && !self.any_under_floor()
    }

    /// `post 143/280 (floor 200)` or `tweet 1 156/280, tweet 2 148/280 (floor 180)`.
    pub fn summary(&self) -> String {
        let units = self
            .measurements
            .iter()
            .map(|m| format!("{} {}/{}", m.label, m.weighted, self.max_weighted_chars))
            .collect::<Vec<_>>()
            .join(", ");
        if self.min_weighted_chars == 0 {
            format!("{units} (no floor)")
        } else {
            format!("{units} (floor {})", self.min_weighted_chars)
        }
    }

    /// The shape defect, if any, then one issue per unit outside the band, in the
    /// validator's own vocabulary.
    pub fn issues(&self) -> Vec<String> {
        let shape = self
            .shape_issue
            .iter()
            .map(|issue| format!("Wrong shape: {issue}"));
        let lengths = self.measurements.iter().filter_map(|m| {
                if m.over_limit {
                    Some(format!(
                        "{} is {} weighted characters; the limit is {} (a URL counts as {URL_WEIGHT}).",
                        m.label, m.weighted, self.max_weighted_chars
                    ))
                } else if m.under_floor {
                    Some(format!(
                        "{} is {} weighted characters; the format asks for at least {} of {}.",
                        m.label, m.weighted, self.min_weighted_chars, self.max_weighted_chars
                    ))
                } else {
                    None
                }
            });
        shape.chain(lengths).collect()
    }

    pub fn revision_instructions(&self) -> Vec<String> {
        let mut instructions = Vec::new();
        if let Some(issue) = &self.shape_issue {
            instructions.push(format!("Return the shape the format asks for: {issue}"));
        }
        if self.any_over_limit() {
            instructions.push(format!(
                "Cut every unit over {} weighted characters down to the limit without dropping the source URL.",
                self.max_weighted_chars
            ));
        }
        if self.any_under_floor() {
            instructions.push(format!(
                "Develop every unit under {} weighted characters until it sits inside the band ({}): add the mechanism, the number with its unit and share, or the consequence; do not pad or restate.",
                self.min_weighted_chars, self.band
            ));
        }
        instructions
    }
}

/// X-weighted length as X-Manager's `twitterWeightedLength` computes it: UTF-16 units,
/// with every http(s) URL counted as [`URL_WEIGHT`].
pub fn weighted_len(text: &str) -> usize {
    let mut length = text.encode_utf16().count();
    for url in find_urls(text) {
        length = length - url.encode_utf16().count() + URL_WEIGHT;
    }
    length
}

/// ECMAScript `\s` (WhiteSpace plus LineTerminator). Not `char::is_whitespace`: JavaScript
/// counts U+FEFF as whitespace and U+0085 as not, Rust the other way round.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n'
            | '\u{0B}'
            | '\u{0C}'
            | '\r'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// Mirrors the web app's `/https?:\/\/[^\s)}\]]+/g`.
fn find_urls(text: &str) -> Vec<&str> {
    let mut urls = Vec::new();
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        let scheme = if rest.starts_with("https://") {
            Some("https://".len())
        } else if rest.starts_with("http://") {
            Some("http://".len())
        } else {
            None
        };
        if let Some(scheme_len) = scheme {
            let tail = &rest[scheme_len..];
            let body_len = tail
                .char_indices()
                .find(|(_, c)| is_js_whitespace(*c) || matches!(c, ')' | '}' | ']'))
                .map(|(offset, _)| offset)
                .unwrap_or(tail.len());
            if body_len > 0 {
                let end = index + scheme_len + body_len;
                urls.push(&text[index..end]);
                index = end;
                continue;
            }
        }
        index += rest.chars().next().map(char::len_utf8).unwrap_or(1);
    }
    urls
}

/// `---` frontmatter of `key: value` lines, then the body.
fn split_frontmatter(raw: &str) -> Result<(Vec<(String, String)>, &str)> {
    let raw = raw.trim_start_matches('\u{feff}');
    let mut lines = raw.split_inclusive('\n');
    let opener = lines.next().unwrap_or("");
    if opener.trim() != "---" {
        bail!("the skill must start with a `---` frontmatter");
    }
    let mut fields = Vec::new();
    let mut consumed = opener.len();
    let mut closed = false;
    for line in lines {
        consumed += line.len();
        let trimmed = line.trim();
        if trimmed == "---" {
            closed = true;
            break;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (key, value) = trimmed
            .split_once(':')
            .with_context(|| format!("frontmatter line `{trimmed}` is not `key: value`"))?;
        fields.push((
            key.trim().to_owned(),
            value.trim().trim_matches('"').to_owned(),
        ));
    }
    if !closed {
        bail!("the frontmatter is not closed with `---`");
    }
    Ok((fields, &raw[consumed..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(text: &str, tweets: &[&str]) -> ContentCandidate {
        ContentCandidate {
            text: text.into(),
            tweets: tweets.iter().map(|t| t.to_string()).collect(),
            rationale: String::new(),
            sources: Vec::new(),
        }
    }

    fn spec(format: Format, min: usize, max: usize) -> FormatSpec {
        FormatSpec {
            format,
            guidance: "guidance".into(),
            max_weighted_chars: max,
            min_weighted_chars: min,
        }
    }

    #[test]
    fn urls_count_as_twenty_three() {
        assert_eq!(weighted_len("plain text"), 10);
        assert_eq!(
            weighted_len("see https://example.com/a/very/long/path/that/goes/on"),
            4 + 23
        );
        assert_eq!(
            weighted_len("(https://x.y) and http://a.b/c."),
            1 + 23 + 1 + 5 + 23
        );
        assert_eq!(weighted_len("https:// alone"), "https:// alone".len());
        // UTF-16 units, as the web app counts: an emoji is two.
        assert_eq!(weighted_len("a🧵"), 3);
        // Punctuation stays inside the URL, exactly as the web app's regex keeps it.
        assert_eq!(weighted_len("https://a.b/c, next"), 23 + 5);
        // Two URLs are one match when nothing the regex stops at separates them.
        assert_eq!(weighted_len("https://a.bhttps://c.d"), 23);
        assert_eq!(weighted_len("https://a.b https://c.d"), 23 + 1 + 23);
        // Supplementary characters inside a URL still collapse to 23.
        assert_eq!(weighted_len("https://a.b/🧵 x"), 23 + 2);
    }

    #[test]
    fn url_termination_follows_ecmascript_whitespace() {
        // JavaScript's `\s` contains U+FEFF: the URL ends there.
        assert_eq!(weighted_len("https://a.b\u{FEFF}tail"), 23 + 1 + 4);
        // ...and not U+0085: the URL runs through it.
        assert_eq!(weighted_len("https://a.b\u{85}tail"), 23);
        assert_eq!(weighted_len("https://a.b\u{A0}tail"), 23 + 1 + 4);
        assert_eq!(weighted_len("https://a.b\u{3000}tail"), 23 + 1 + 4);
        assert_eq!(weighted_len("https://a.b\u{2028}tail"), 23 + 1 + 4);
        assert!(is_js_whitespace('\u{FEFF}') && !is_js_whitespace('\u{85}'));
        assert!(is_js_whitespace('\u{2005}') && !is_js_whitespace('\u{200B}'));
    }

    #[test]
    fn maps_tasks_to_formats() {
        assert_eq!(Format::for_task("reply", false), Format::Reply);
        assert_eq!(Format::for_task("reply", true), Format::Reply);
        assert_eq!(Format::for_task("post", true), Format::Thread);
        assert_eq!(Format::for_task("post", false), Format::Post);
        // Only a post task can become a thread; anything else stays a post.
        assert_eq!(Format::for_task("research", true), Format::Post);
        assert_eq!(Format::for_task("", true), Format::Post);
    }

    #[test]
    fn a_post_that_came_back_as_a_thread_is_a_shape_defect() {
        let spec = spec(Format::Post, 200, 280);
        // An over-limit text hidden behind in-band tweets: the text is what is measured.
        let report = spec.check(&candidate(&"x".repeat(281), &[&"a".repeat(250), &"b".repeat(250)]));
        assert!(!report.within_band());
        assert!(report.any_over_limit());
        assert_eq!(report.measurements.len(), 1);
        assert_eq!(report.measurements[0].label, "post");
        let issues = report.issues();
        assert_eq!(issues.len(), 2, "{issues:?}");
        assert!(issues[0].starts_with("Wrong shape: the post format is a single `text`"), "{issues:?}");
        assert!(issues[1].contains("limit is 280"), "{issues:?}");
        assert!(report.revision_instructions()[0].starts_with("Return the shape"));

        // In-band text with a stray thread is still not within the band.
        let stray = spec.check(&candidate(&"x".repeat(250), &["one", "two"]));
        assert!(!stray.within_band() && stray.shape_issue.is_some());

        // A single stray entry in `tweets` is not a thread and is ignored downstream too.
        let harmless = spec.check(&candidate(&"x".repeat(250), &["one"]));
        assert!(harmless.within_band());
    }

    #[test]
    fn a_thread_that_came_back_as_one_post_is_a_shape_defect() {
        let spec = spec(Format::Thread, 180, 280);
        let report = spec.check(&candidate(&"x".repeat(250), &[]));
        assert!(!report.within_band());
        assert_eq!(report.measurements.len(), 1);
        assert_eq!(report.measurements[0].label, "thread");
        assert!(report.issues()[0].contains("needs at least 2 non-empty tweets"), "{:?}", report.issues());

        // One non-empty tweet is not a thread either.
        let one = spec.check(&candidate(&"x".repeat(250), &[&"y".repeat(250), "  "]));
        assert!(one.shape_issue.as_deref().is_some_and(|issue| issue.contains("got 1 non-empty")), "{:?}", one.shape_issue);
    }

    #[test]
    fn parses_frontmatter_and_body() {
        let raw = "---\nname: post\ndescription: \"quoted\"\nmax_weighted_chars: 280\nmin_weighted_chars: 200\n---\n\n# Body\ntext\n";
        let spec = FormatSpec::parse(Format::Post, raw).expect("valid skill");
        assert_eq!(spec.max_weighted_chars, 280);
        assert_eq!(spec.min_weighted_chars, 200);
        assert_eq!(spec.guidance, "# Body\ntext");
        assert_eq!(
            spec.band(),
            "post: 200 to 280 weighted characters per unit (a URL counts as 23)"
        );
    }

    #[test]
    fn parses_windows_line_endings() {
        let raw = "---\r\nname: post\r\nmax_weighted_chars: 280\r\nmin_weighted_chars: 200\r\n---\r\n\r\n# Body\r\n";
        let spec = FormatSpec::parse(Format::Post, raw).expect("valid skill");
        assert_eq!(spec.guidance, "# Body");
    }

    #[test]
    fn rejects_broken_frontmatter() {
        let cases = [
            ("no frontmatter", "# Body"),
            (
                "wrong name",
                "---\nname: reply\nmax_weighted_chars: 280\nmin_weighted_chars: 0\n---\nbody",
            ),
            ("missing max", "---\nname: post\nmin_weighted_chars: 0\n---\nbody"),
            (
                "floor above limit",
                "---\nname: post\nmax_weighted_chars: 100\nmin_weighted_chars: 200\n---\nbody",
            ),
            (
                "unclosed",
                "---\nname: post\nmax_weighted_chars: 280\nmin_weighted_chars: 0\n",
            ),
            (
                "empty body",
                "---\nname: post\nmax_weighted_chars: 280\nmin_weighted_chars: 0\n---\n\n",
            ),
        ];
        for (case, raw) in cases {
            assert!(
                FormatSpec::parse(Format::Post, raw).is_err(),
                "{case} should be rejected"
            );
        }
    }

    #[test]
    fn measures_a_post_against_its_band() {
        let spec = spec(Format::Post, 200, 280);
        let short = spec.check(&candidate(&"x".repeat(143), &[]));
        assert!(short.any_under_floor() && !short.any_over_limit());
        assert_eq!(short.summary(), "post 143/280 (floor 200)");
        assert_eq!(
            short.issues(),
            vec!["post is 143 weighted characters; the format asks for at least 200 of 280."]
        );
        assert_eq!(short.revision_instructions().len(), 1);

        let long = spec.check(&candidate(&"x".repeat(281), &[]));
        assert!(long.any_over_limit() && !long.any_under_floor());

        let fine = spec.check(&candidate(&"x".repeat(250), &[]));
        assert!(fine.within_band());
        assert!(fine.issues().is_empty());
    }

    #[test]
    fn measures_every_tweet_of_a_thread() {
        let spec = spec(Format::Thread, 180, 280);
        let thread = spec.check(&candidate(
            "first",
            &[&"a".repeat(156), &"b".repeat(240), &"c".repeat(300)],
        ));
        assert_eq!(thread.measurements.len(), 3);
        assert_eq!(
            thread.summary(),
            "tweet 1 156/280, tweet 2 240/280, tweet 3 300/280 (floor 180)"
        );
        assert!(thread.any_under_floor() && thread.any_over_limit());
        assert_eq!(thread.issues().len(), 2);
        assert_eq!(thread.revision_instructions().len(), 2);
    }

    #[test]
    fn replies_have_no_floor() {
        let spec = spec(Format::Reply, 0, 280);
        let report = spec.check(&candidate("Correct. Also beside the point.", &[]));
        assert!(report.within_band());
        assert_eq!(report.summary(), "reply 31/280 (no floor)");
    }

    #[tokio::test]
    async fn the_shipped_format_skills_are_valid() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        for format in [Format::Post, Format::Thread, Format::Reply] {
            let spec = FormatSpec::load(root, format)
                .await
                .expect("shipped skill must load");
            assert_eq!(spec.format, format);
            assert_eq!(spec.max_weighted_chars, 280);
            assert!(spec.guidance.starts_with("# Format:"), "{}", format.name());
        }
        let reply = FormatSpec::load(root, Format::Reply)
            .await
            .expect("reply skill");
        assert_eq!(reply.min_weighted_chars, 0);
        let post = FormatSpec::load(root, Format::Post)
            .await
            .expect("post skill");
        assert!(post.min_weighted_chars >= 180);
    }
}
