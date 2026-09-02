---
name: thread
description: Multi-tweet breakdown of a long read. Every tweet is a full post, not a slice.
max_weighted_chars: 280
min_weighted_chars: 180
---

# Format: thread

A thread is a sequence of full posts, each of which survives being seen alone in a timeline. It is not one post cut into slices.

## Budget, per tweet

- Hard limit: 280 weighted characters per tweet. A URL counts as 23.
- Working band per tweet: 180 to 280. Write toward 230 to 270. The worker measures every tweet; one tweet under 180 sends the whole thread back for a rewrite with the measured numbers.
- Fewer, fuller tweets beat more, thinner ones. If the material fills three tweets properly, return three. The task's `max_tweets` is a ceiling, not a target.

## Structure

1. Tweet 1, the hook: the account's claim and why it matters, standing alone. Not "a thread on X". A complete post someone could quote by itself.
2. Middle tweets: one developed idea each. The mechanism. The number with its unit and what it is a share of. The step everyone skips. The counter-argument and why it fails. Each tweet carries its own evidence; "as above" is a slice.
3. The last tweet: the account's verdict plus the source URL. The URL lives here (23 characters); budget for it.

## Quotations

Only from `source_notes[].quotes`, verbatim, in quotation marks, with attribution (— Author, Outlet). At most one short quotation per tweet. A quotation never replaces the tweet's own idea: the tweet still says what the account makes of it. Never invent or alter a quotation.

## Do not

- Number the tweets ("1/", "2/") or announce a thread ("🧵", "a thread on").
- Repeat the previous tweet's claim as a bridge.
- Spread one idea over two tweets to reach `max_tweets`.
- End a tweet on a line whose only job is to make the reader tap the next one.

## The brief's samples

Sample posts in the brief show temperature and diction, not length. Match their temperature, ignore their length: the band above wins on length, the brief wins on voice.

## Output

Every tweet, in order, in `tweets`. The first tweet repeated in `text`.
