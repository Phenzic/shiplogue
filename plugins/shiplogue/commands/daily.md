---
description: Write today's Shiplogue stand-up from local agent activity
argument-hint: "[detail: concise|standard|elaborate] [tone: neutral|junior|mid|senior]"
---

# /shiplogue:daily

Run the `daily` skill flow:

1. Call `get_activity`.
2. Write the stand-up yourself with this model.
3. Call `save_standup`.
4. Show the saved Markdown and draft path.

Do not request a model API key. A Shiplogue Cloud project key is only needed for
cloud sync/posting.
