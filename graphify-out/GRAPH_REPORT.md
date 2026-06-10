# Graph Report - .  (2026-06-11)

## Corpus Check
- Corpus is ~3,114 words - fits in a single context window. You may not need a graph.

## Summary
- 47 nodes · 107 edges · 9 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Telegram Webhook Navigation Handlers|Telegram Webhook Navigation Handlers]]
- [[_COMMUNITY_Package Manifest with LibSQL|Package Manifest with LibSQL]]
- [[_COMMUNITY_Cart and Product Session State|Cart and Product Session State]]
- [[_COMMUNITY_Admin Panel and Database|Admin Panel and Database]]
- [[_COMMUNITY_Vercel Deployment Config|Vercel Deployment Config]]
- [[_COMMUNITY_Cart Totals and Session|Cart Totals and Session]]
- [[_COMMUNITY_Cart Items Helpers|Cart Items Helpers]]
- [[_COMMUNITY_Input Validation and Sanitization|Input Validation and Sanitization]]
- [[_COMMUNITY_Public Entry and CI|Public Entry and CI]]

## God Nodes (most connected - your core abstractions)
1. `handler()` - 23 edges
2. `tg()` - 16 edges
3. `handleTextInput()` - 12 edges
4. `getSession()` - 9 edges
5. `db()` - 7 edges
6. `ensureSchema()` - 7 edges
7. `cartTotal()` - 5 edges
8. `cartText()` - 5 edges
9. `handleAdd()` - 5 edges
10. `handleCart()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `CI Syntax Check Workflow` --references--> `Secret KZ Bot Redirect`  [INFERRED]
  .github/workflows/ci.yml → public/index.html

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "Telegram Webhook Navigation Handlers"
Cohesion: 0.31
Nodes (11): handleBackMain(), handleCatalog(), handleCategory(), handleContacts(), handleDelivery(), handleProduct(), handler(), isVerified() (+3 more)

### Community 1 - "Package Manifest with LibSQL"
Cohesion: 0.29
Nodes (6): dependencies, @libsql/client, name, private, type, version

### Community 2 - "Cart and Product Session State"
Cohesion: 0.33
Nodes (5): CATEGORIES, handleCheckout(), handleClearCart(), PRODUCTS, sessions

### Community 3 - "Admin Panel and Database"
Cohesion: 0.70
Nodes (5): db(), ensureSchema(), handleAdminCustomers(), handleAdminOrders(), handleAdminStats()

### Community 4 - "Vercel Deployment Config"
Cohesion: 0.40
Nodes (4): maxDuration, functions, api/webhook.js, rewrites

### Community 5 - "Cart Totals and Session"
Cohesion: 0.83
Nodes (4): cartText(), cartTotal(), getSession(), handleAdd()

### Community 6 - "Cart Items Helpers"
Cohesion: 0.67
Nodes (3): cartHasItems(), cartItems(), handleCart()

### Community 7 - "Input Validation and Sanitization"
Cohesion: 0.67
Nodes (3): handleTextInput(), parseAge(), sanitize()

### Community 8 - "Public Entry and CI"
Cohesion: 0.67
Nodes (3): Secret KZ Anonymous Store Telegram Bot, Secret KZ Bot Redirect, CI Syntax Check Workflow

## Knowledge Gaps
- **12 isolated node(s):** `CATEGORIES`, `PRODUCTS`, `sessions`, `name`, `version` (+7 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handler()` connect `Telegram Webhook Navigation Handlers` to `Cart and Product Session State`, `Admin Panel and Database`, `Cart Totals and Session`, `Cart Items Helpers`, `Input Validation and Sanitization`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `tg()` connect `Telegram Webhook Navigation Handlers` to `Cart and Product Session State`, `Admin Panel and Database`, `Cart Totals and Session`, `Cart Items Helpers`, `Input Validation and Sanitization`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `handleTextInput()` connect `Input Validation and Sanitization` to `Telegram Webhook Navigation Handlers`, `Cart and Product Session State`, `Admin Panel and Database`, `Cart Totals and Session`, `Cart Items Helpers`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `CATEGORIES`, `PRODUCTS`, `sessions` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._