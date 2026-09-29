# Contract: `config.json`

This is the only file the user edits to tune the radar (FR-025). Field rules are in
[data-model.md › Config](../data-model.md#config). Unknown keys are rejected so that typos are
caught.

## Initial file

```json
{
  "maxPagesPerSearch": 2,
  "maxRequestsPerRun": 15,
  "delayMs": { "min": 2000, "max": 5000 },
  "digestThreshold": 15,
  "stateRetentionDays": 30,
  "searches": [
    { "id": "angular-egypt",            "keywords": "Angular",          "geoId": "106155005", "remoteOnly": false, "experienceLevels": [4, 5], "postedWithinSeconds": 86400 },
    { "id": "frontend-egypt",           "keywords": "Frontend",         "geoId": "106155005", "remoteOnly": false, "experienceLevels": [4, 5], "postedWithinSeconds": 86400 },
    { "id": "angular-worldwide-remote", "keywords": "Angular",          "geoId": "92000000",  "remoteOnly": true,  "experienceLevels": [4, 5], "postedWithinSeconds": 86400 },
    { "id": "frontend-angular-remote",  "keywords": "Frontend Angular", "geoId": "92000000",  "remoteOnly": true,  "experienceLevels": [4, 5], "postedWithinSeconds": 86400 }
  ],
  "includeTitleTerms": ["angular*"],
  "conditionalTitleTerms": ["front-end", "frontend", "front end", "ui engineer", "web developer"],
  "descriptionRequiredTerms": ["angular*"],
  "excludeTitleTerms": ["junior", "intern", "internship", "trainee", "react only", "php", "wordpress", ".net developer"],
  "relocationPatterns": [
    "relocat",
    "must (?:be )?(?:located|based|resid\\w*) in",
    "(?:located|based) in the (?:us|usa|uk|eu|united states|united kingdom|european union)\\b",
    "\\b(?:us|uk|eu)[- ]based (?:only|candidates)",
    "only (?:open to|accepting) (?:candidates|applicants) (?:from|in)"
  ]
}
```

## Search → request URL mapping

```text
https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
  ?keywords=<urlencoded keywords>
  &geoId=<geoId>
  &f_TPR=r<postedWithinSeconds>
  &f_E=<experienceLevels joined by ",">        (URL-encoded comma)
  [&f_WT=2                                      only when remoteOnly]
  &start=<page * 10>
```

The description URL is `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>`.
