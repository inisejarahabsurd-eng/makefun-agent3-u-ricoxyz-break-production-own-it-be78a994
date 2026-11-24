Place the harness's own saved session JSON files here (OpenAI or Anthropic message
format, one JSON per session). Then run from the repo root:

    node cli/makefun.mjs bundle
    node cli/makefun.mjs check bundle.tar.gz

bundle discovers every .json in this directory, keeps each session whole
(including subagents), strips e-mail addresses, home paths and usernames on its
own, and applies any --redact / --redact-file terms before taring.

Never write, rebuild, or summarise a session from memory to fill a gap.
Never pass off a session made after the fact as the harness's log.