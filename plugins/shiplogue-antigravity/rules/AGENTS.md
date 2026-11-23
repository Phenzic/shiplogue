# Shiplogue stand-ups

When the user asks for their daily stand-up, use the Shiplogue `shiplogue-daily` skill.

1. Call the Shiplogue `get_activity` MCP tool for the repo and lookback window.
2. Write the stand-up with this agent's own model; never ask for a model API key.
3. Call `save_standup` exactly once with the finished Markdown.
4. Show the saved draft and any quality suggestions. Do not rewrite and save
   again automatically unless the user asks.

Cloud sync/posting is optional and requires a Shiplogue project key.
