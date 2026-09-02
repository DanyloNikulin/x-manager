---
name: thread
description: One argument in steps about a long read. Every tweet is a step of the argument, not a fact from the piece.
max_weighted_chars: 280
min_weighted_chars: 180
---

# Format: thread

A thread is one argument in steps. Each step is a full post that survives being seen alone in a timeline. It is not the piece retold in slices, and not a list of its figures.

## Structure

1. Tweet 1, the position: the claim and why it matters, standing alone. A complete post someone could quote by itself. Not "a thread on X", not the first number of the piece.
2. Middle tweets, one step of the argument each: the mechanism; the strongest fact the piece offers and what it actually shows; what the piece leaves out; the counter-argument and why it fails. Each tweet carries its own reasoning. "As above" is a slice.
3. The last tweet: the verdict, and the source URL (23 characters; budget for it).

The test for every tweet: delete its numbers and names. A sentence with a point must remain.

## Evidence and quotations

At most one figure per tweet, with its unit and what it is a share of. Quote only from `source_notes[].quotes`, verbatim, in quotation marks, with attribution (— Author, Outlet), at most one short quotation per tweet, and always to argue with it or from it, never to decorate. Never invent or alter a quotation.

## Where the opinion comes from

Open the source before writing: with the web fetch tool when one is available, otherwise from `source_notes`. Read it the way the account would. What does it take for granted, what does it leave out, who is missing, which number does the work? The thread argues with the piece, or past it. It never retells it.

## Budget, per tweet

- Hard limit: 280 weighted characters per tweet. A URL counts as 23.
- Working band: 180 to 280, written toward 230 to 270. The worker measures every tweet; one tweet under 180 sends the whole thread back once with the numbers.
- Fewer, fuller tweets beat more, thinner ones. If the argument has three steps, return three. The task's `max_tweets` is a ceiling, not a target.

## Do not

- Number the tweets ("1/", "2/") or announce a thread ("🧵", "a thread on").
- Give each tweet one figure and call that an idea.
- Repeat the previous tweet's claim as a bridge, or end a tweet on a line whose only job is the next tap.
- Spread one step over two tweets to reach `max_tweets`.

## The brief's samples

Sample posts in the brief show temperature and diction, not length and not depth. Match the temperature. The band wins on length, the brief wins on voice.

## Output

Every tweet, in order, in `tweets`. The first tweet repeated in `text`.
