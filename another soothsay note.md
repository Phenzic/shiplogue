king.

### TL;DR  
The tweet is essentially a **“Brave‑Search‑First SEO playbook”** for Claude‑type AIs.  
If you build *soothsay* around it, your app will:

| What the tweet says | Why it matters for AI visibility | How to implement it in *soothsay* |
|----------------------|-----------------------------------|------------------------------------|
| **Submit every key page to Brave** | Claude pulls its web‑search data from Brave. If a page is never in Brave’s index, Claude can’t 
see it. | Add an “Index Me” wizard that posts URLs via `https://search.brave.com/submit-url`. |
| **Make Googlebot happy** | Brave explicitly skips any URL that Googlebot can’t crawl; a robots.txt or CDN issue kills visibility 
before the AI even checks. | Run a *crawl‑ability audit* (robots.txt, noindex tags, CDN cache headers). Flag problems and auto‑suggest 
fixes. |
| **Get indexed + ranked** | Brave’s crawl budget is limited to “popular” pages with good link signals. Low‑signal content will stay 
buried even if indexed. | Show a *link‑juice score* (internal/external links, backlinks) and popularity alerts. Provide 
schema/metadata suggestions that boost signal. |
| **Target the queries Claude actually searches** | “X vs Y”, “best X in 2026” etc. trigger Claude’s web search far more often than 
static questions. | Build a *query‑type profiler* that tags pages as “comparison”, “location‑heavy”, “freshness‑heavy”, etc., and maps 
them to AI‑trigger keywords. |
| **Track Brave rankings** | If your page is indexed but not in the top 3‑5 results, Claude will still cite competitors. | Integrate a 
*Brave SERP tracker* (scrape search.brave.com or use any available API) for those AI‑trigger queries. Show position over time and 
“to‑rank” recommendations. |
| **Simulate Claude & inspect citations** | Knowing whether your page is cited, and how it’s re‑ranked, tells you if the problem is 
indexing vs retrieval. | Create a *Claude‑QA sandbox*: let users type in prompts, run Claude with web search, and visualize the 
citation list (URLs + snippet). Highlight where their content appears or is missing. |

---

## 1. The Core Insight: AI = Brave Indexer

- **Claude’s “Web Search” engine → Brave**.  
- If a page never lands in Brave, it can’t be quoted by Claude.  
- Therefore *visibility for AIs* is not just about Google; it’s specifically about Brave.

> **Your tool must first make sure the content exists in Brave’s index.**

---

## 2. Concrete Steps to Translate into Features

| Step | Feature Idea | Why It Helps |
|------|--------------|-------------|
| **URL Submission** | “Submit to Brave” button that posts to `https://search.brave.com/submit-url`. Offer bulk CSV import. | 
Guarantees the URL is queued for crawling. |
| **Crawl‑ability Checker** | Automated run of: <ul><li>robots.txt validator</li><li>noindex/tag scan</li><li>Curl fetch with 200 vs 
403/404</li></ul> | Flags problems that Brave will ignore, saving time on re‑submissions. |
| **Crawl Budget Optimizer** | Compute “link juice” = #internal links + backlinks × weight. Suggest adding internal links or earning 
external links to boost signal. | Drives content deeper into Brave’s crawling priorities. |
| **Schema & Metadata Helper** | Auto‑insert/validate FAQ, HowTo, Product, Review JSON‑LD based on article type. | Schema signals are 
a key “popularity” indicator for Brave. |
| **Query‑Type Tagger** | AI model that reads the article and tags it: comparison, ranking, location, freshness. | Allows content 
creators to focus on high‑yield AI query formats. |
| **Brave SERP Tracker** | Poll `https://search.brave.com/search?q=<encoded>` for specified queries; parse top 10 results. | Shows 
real‑time ranking and competitor analysis specifically for Brave. |
| **Claude Test Suite** | Let users feed a prompt to Claude (via API) with web search enabled, capture the response JSON, highlight 
citations. | End‑to‑end validation: “Did my page get cited? Where did I lose rank?” |
| **Report Dashboard** | Summarize: URLs indexed? Rank % in Brave? How many times quoted by Claude? | Decision‑making hub for content 
optimization teams. |

---

## 3. Example Workflow a Content Owner Might Use

1. **Author an article** on “Best Electric Cars 2026”.
2. In *soothsay*, click **“Optimize for AI”** → The system:
   - Detects it’s a comparison/ranking piece.
   - Adds recommended schema (Product, FAQ).
   - Submits the URL to Brave.
3. Tool runs a crawl‑ability check: no `noindex`, Googlebot can fetch → passes.
4. **Brave SERP Tracker** shows the article is currently ranked 12th for “best electric cars 2026”.
5. *Soothsay* suggests:
   - Adding two authoritative backlinks to push signal.
   - Creating a side‑by‑side comparison table (schema `ProductComparison`).
6. After implementing changes, re‑run tracker: rank jumps to #4.
7. **Claude Test Suite**: user asks Claude “Which electric car is best in 2026?” – the response cites the new article.  
   - Dashboard marks “✓ Citation achieved”.

---

## 4. Why This Is Different from Traditional SEO

| Traditional SEO | AI‑Optimized SEO (soothsay) |
|-----------------|-----------------------------|
| Focus on Google Search Console, link building | Focus on Brave index + AI query patterns |
| Broad keyword research | Query‑type profiling (“X vs Y” triggers web search) |
| Rank in 10–20 SERP positions | Cite frequency & position in Claude’s answer |
| Generic schema (FAQ, Product) | Schema that signals *comparison* and *ranking* value |

---

## 5. Additional Recommendations

1. **Integrate with Google Search Console**: While Brave is the primary index for Claude, you still need to maintain Google 
visibility. Offer a side‑by‑side dashboard.
2. **Use “Freshness” Signals**: For year‑specific queries (e.g., “2026”), set up automated content refresh alerts or auto‑regen of 
meta descriptions.
3. **Link to OpenAI’s “Embeddings & Retrieval”**: Provide optional export of article embeddings that can be used for custom retrieval 
in private AI agents.
4. **Monitor AI Feedback Loops**: Some AIs (Claude, Gemini) may re‑rank Brave results based on their own internal signals. Offer a 
*“re‑ranking simulation”* where the tool shows how different ranking tweaks affect AI answers.

---

### Bottom Line

The tweet isn’t just about “submit to Brave and hope for the best”; it’s a step‑by‑step **blueprint**:

1. Get every important page in Brave’s index.  
2. Make sure Brave can actually crawl them (Googlebot ≠ noindex).  
3. Build signal—links, schema, popularity—to push those pages into the top results.  
4. Focus on AI‑triggered query types where Claude actually turns to the web.  
5. Measure where you rank in Brave for those queries and iterate until you’re cited.

If *soothsay* wraps all of that in a single user journey—submission, audit, schema, ranking monitor, Claude sandbox—you’ll give 
content creators exactly what they need: **SEO for AI agents**.

>>> Send a message (/? for help)
