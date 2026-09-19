---
title: "Photographer portfolio input is unnormalized source text"
modules: ["photographers"]
areas: ["module-data"]
topics: ["validation", "source-data"]
---

# Photographer portfolio input is unnormalized source text

The portfolio entry may contain a URL, a social handle, or a statement that no
portfolio exists. Naming it portfolio_url and validating it as a URL incorrectly
rejects valid source submissions. Use portfolio_raw / portfolioRaw, preserve the
text, and defer normalization and processing decisions to a separate later step.
Renaming an encrypted column also requires migrating its encryption-map field
name and refreshing the query index.
