# Feature Specification: LinkedIn Job Radar

**Feature Branch**: `001-linkedin-job-radar`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "docs/PLAN.md — phone alerts when new matching LinkedIn jobs are posted (Lead Angular Developer, Egypt + worldwide remote), without using a LinkedIn account or token, running unattended in the cloud."

## Clarifications

### Session 2026-09-29

- Q: If reading a job's description fails, or sending its alert fails, is the job still marked as seen? → A: No. It stays unseen, and the next run tries it again (FR-010a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a phone alert for each new matching job (Priority: P1)

As a Lead Angular Developer in Cairo, I want a message on my phone shortly after a relevant new job is posted on LinkedIn, so I can apply early without manually searching several times a day. A relevant job is a Mid-Senior or Director level Angular / Angular-focused frontend role that is either located in Egypt (on-site, hybrid or remote) or fully remote worldwide.

**Why this priority**: This is the core value of the product. Without it nothing else matters.

**Independent Test**: Run the radar once with an existing list of already-seen jobs. After a new matching posting appears, the next run sends exactly one alert containing the job title, company, location/work type, posting age and a direct link.

**Acceptance Scenarios**:

1. **Given** a new posting titled "Senior Angular Developer" in Cairo at Mid-Senior level, **When** the radar runs, **Then** the user receives one alert showing title, company, location with work type, how long ago it was posted, and a link that opens the job.
2. **Given** a job the user was already alerted about, **When** the radar runs again, **Then** no second alert is sent for that job.
3. **Given** a new posting titled "Frontend Engineer" whose description mentions Angular, **When** the radar runs, **Then** the user is alerted.
4. **Given** a new posting titled "Frontend Engineer" whose description does not mention Angular, **When** the radar runs, **Then** no alert is sent.
5. **Given** a posting titled "Junior Angular Developer", "Angular Intern", or a title matching any configured exclusion term, **When** the radar runs, **Then** no alert is sent.
6. **Given** a search result that is unrelated to the target role (e.g., a lawyer job returned for an "Angular" search), **When** the radar runs, **Then** no alert is sent.

---

### User Story 2 - Runs by itself without risking my LinkedIn account (Priority: P1)

As the user, I want the radar to run on a fixed schedule in the cloud, even when my PC is off, and never to use my LinkedIn login, cookies or network address, so that my LinkedIn account can't be restricted or banned because of it.

**Why this priority**: Account safety was a hard requirement from the start. Unattended operation is what makes the alerts useful.

**Independent Test**: Deploy the radar, turn the PC off, and confirm that scheduled runs keep happening (visible in the run history) and that no LinkedIn credentials exist anywhere in the project or its settings.

**Acceptance Scenarios**:

1. **Given** the radar is deployed, **When** 24 hours pass with the user's PC off, **Then** runs happen roughly every 30 minutes and the user keeps getting alerts.
2. **Given** LinkedIn answers with a rate-limit or blocking response, **When** the radar runs, **Then** it retries at most twice with growing waits, then skips that search for this run without failing the whole run.
3. **Given** any run, **When** it finishes, **Then** it has sent no more than about 15 requests to LinkedIn, with a random pause of 2–5 seconds between requests.
4. **Given** a manual trigger by the user, **When** it is started, **Then** a run happens right away without waiting for the schedule.

---

### User Story 3 - No flood on first start or busy days (Priority: P2)

As the user, I don't want dozens of messages when the radar starts for the first time, or when many jobs appear at once.

**Why this priority**: A flood of messages makes users mute or abandon the alerts. This matters for daily usability, but the core alerts come first.

**Independent Test**: Start with an empty seen-jobs history and run once. The user gets exactly one summary message ("Radar started — N jobs currently open") and no individual alerts.

**Acceptance Scenarios**:

1. **Given** no history of seen jobs, **When** the radar runs for the first time, **Then** every current match is recorded as seen and a single "Radar started — N jobs currently open" message is sent.
2. **Given** more than 15 new matching jobs in one run, **When** alerts are sent, **Then** the user gets one digest message listing them instead of separate messages.
3. **Given** 15 or fewer new matches, **When** alerts are sent, **Then** each job gets its own message, spaced about one second apart.

---

### User Story 4 - Spot remote jobs that are not truly remote for me (Priority: P3)

As a candidate who won't relocate, I want worldwide-remote alerts to be flagged when the description mentions relocation or requires living in a specific country or region, so I can skip them quickly. They should still be sent, so I don't miss real remote roles.

**Why this priority**: This saves triage time but doesn't change which jobs are found.

**Independent Test**: Feed a worldwide-remote job whose description says "must be located in the US". The alert is sent and carries a visible relocation/location warning.

**Acceptance Scenarios**:

1. **Given** a worldwide-remote match whose description mentions relocation, **When** it is alerted, **Then** the alert includes a "⚠️ mentions relocation" style warning.
2. **Given** a worldwide-remote match whose description says the candidate must be based in the US, UK or EU, **When** it is alerted, **Then** the alert carries the same warning.
3. **Given** a worldwide-remote match with no such wording, **When** it is alerted, **Then** no warning is shown.

---

### User Story 5 - Tune searches without editing code (Priority: P3)

As the user, I want to change search keywords, locations, seniority levels, and include/exclude title terms by editing one settings file, so I can adjust the radar without programming changes.

**Why this priority**: This matters once the radar is running and false positives or misses show up.

**Independent Test**: Add "react only" to the exclusion list in the settings file and rerun. A job titled "Frontend Developer (React only)" is no longer alerted.

**Acceptance Scenarios**:

1. **Given** the user adds a new search to the settings file, **When** the next run happens, **Then** that search is included.
2. **Given** the user adds an exclusion term, **When** the next run happens, **Then** jobs whose title contains that term are not alerted.

---

### User Story 6 - Try it safely before going live (Priority: P3)

As the user setting it up, I want a dry-run mode that shows what would be found and alerted, without sending messages or changing the seen-jobs history, plus clear written setup steps.

**Why this priority**: This makes setup and troubleshooting easier. It isn't needed for the alerts themselves.

**Independent Test**: Run in dry-run mode. The console lists the parsed jobs (title, company, location, id) and marks which ones were filtered out. No message is sent and the seen-jobs history is unchanged.

**Acceptance Scenarios**:

1. **Given** dry-run mode, **When** the radar runs, **Then** the matched jobs are printed and nothing is sent or saved.
2. **Given** a new user following the setup guide, **When** they finish it, **Then** they can create the messaging bot, find their chat id, store the secrets, and trigger a test run.

---

### Edge Cases

- **Search returns no results or an empty page**: paging stops for that search. This is not treated as an error.
- **The same job appears in more than one search** (e.g., "Angular" and "Frontend Angular"): the user gets only one alert.
- **The job description can't be fetched** for an ambiguous "Frontend" title: the job is not alerted this run and is not marked as seen, so it can be checked again next run.
- **Sending a message fails** (messaging service down or bad credentials): jobs whose alert failed are not marked as seen, so they are retried next run. The run reports the failure.
- **The scheduler delays or skips a run** (cloud scheduled runs can be 5–20 minutes late): the 24-hour search window and seen-jobs history make sure delayed jobs are still caught once and only once.
- **Two runs overlap**: only one runs at a time.
- **Seen-jobs history grows forever**: entries older than 30 days are removed.
- **The scheduler turns itself off after long inactivity**: the regular history updates count as repository activity, which prevents this.
- **The page layout of job listings changes** so no job details can be read: the run reports that zero cards were parsed, not "no new jobs", so the problem can be noticed.
- **A title has both an include term and an exclusion term** (e.g., "Junior Angular Developer"): the exclusion wins.

## Requirements *(mandatory)*

### Functional Requirements

**Discovery**

- **FR-001**: System MUST find job postings using only publicly available, logged-out LinkedIn job listings. No LinkedIn account, login token, cookie or other user credential may be used or stored.
- **FR-002**: System MUST run the configured searches. Initially that is four searches: "Angular" in Egypt (all work types), "Frontend" in Egypt (all work types), "Angular" worldwide remote-only, and "Frontend Angular" worldwide remote-only. All of them are limited to Mid-Senior and Director seniority and to postings from the last 24 hours.
- **FR-003**: System MUST read up to 2 result pages per search and stop early when a page returns no jobs.
- **FR-004**: For each job, the system MUST capture at least: a unique job id, title, company, location, work type where available, posting time, and a direct link to the posting.

**Filtering**

- **FR-005**: System MUST accept a job whose title contains "angular" (case-insensitive).
- **FR-006**: System MUST treat a title containing a frontend-type term ("front-end", "frontend", "front end", "ui engineer", "web developer") as conditionally acceptable. The system reads the job description and accepts the job only if the description mentions "angular". Descriptions are only fetched for jobs not seen before.
- **FR-007**: System MUST reject any job whose title contains a configured exclusion term. The initial list is: junior, intern, trainee, react only, php, wordpress, .net developer. Exclusions take precedence over inclusions.
- **FR-008**: System MUST reject all other jobs whose titles match neither rule.
- **FR-009**: For worldwide-remote matches, the system MUST flag (not drop) jobs whose description mentions relocation or says the candidate must be located or based in the US, UK or EU.

**De-duplication & history**

- **FR-010**: System MUST keep a history of job ids already handled, with the date each was first seen, and MUST NOT alert the same job id twice.
- **FR-010a**: A job MUST be recorded as seen only after it is fully handled: its alert was sent, or it was rejected based on data that was read successfully. If reading the job's description fails, or sending its alert fails, the job MUST stay unseen so the next run tries it again.
- **FR-011**: System MUST remove history entries older than 30 days.
- **FR-012**: History MUST persist between scheduled runs without depending on the user's computer.
- **FR-013**: On the first run (empty history), the system MUST record all current matches as seen and send a single summary message with the count, instead of individual alerts.

**Notifications**

- **FR-014**: System MUST send each new matching job to the user's phone as a message containing title, company, location with work type, relative posting age, the relocation warning when it applies, and the direct link.
- **FR-015**: System MUST space individual messages about 1 second apart.
- **FR-016**: When a run finds more than 15 new matches, the system MUST send one digest message instead of individual messages.
- **FR-017**: Messaging credentials MUST be supplied as secrets, never stored in the project files.

**Politeness & resilience**

- **FR-018**: System MUST identify itself with a realistic desktop browser profile and wait a random 2–5 seconds between requests to LinkedIn.
- **FR-019**: System MUST make no more than about 15 requests to LinkedIn per run.
- **FR-020**: When LinkedIn responds with a rate-limit or block, the system MUST back off with growing waits and retry at most 2 times, then skip that search for the run.
- **FR-021**: A failure in one search MUST NOT stop the other searches or the sending of alerts for jobs already found.

**Operation & configuration**

- **FR-022**: System MUST run automatically every 30 minutes in a cloud environment that works while the user's PC is off, and MUST NOT run more often than that.
- **FR-023**: System MUST allow a manual on-demand run.
- **FR-024**: System MUST prevent overlapping runs.
- **FR-025**: Searches, include terms, conditional terms and exclusion terms MUST be editable in a single settings file without code changes.
- **FR-026**: System MUST provide a dry-run mode that prints the parsed and filtered jobs and doesn't send messages or change history.
- **FR-027**: System MUST include setup documentation covering bot creation, getting the chat id, storing secrets, and triggering a test run.

### Key Entities

- **Search**: One configured query. It has keywords, a geographic area (Egypt or worldwide), allowed work types (any, or remote only), seniority levels, a time window, and a page limit.
- **Job Posting**: One job found by a search. It has a unique id, title, company, location, work type, posting time, link, the description (only when fetched), and a relocation-warning flag.
- **Filter Rules**: The lists of include terms, conditional (description-check) terms, and exclusion terms, plus the relocation/location-restriction patterns.
- **Seen History**: A mapping from job id to the date it was first seen. It persists between runs and is pruned after 30 days.
- **Alert**: A message sent to the user. It is an individual job alert, a digest of many jobs, or the first-run summary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of new matching jobs are alerted within 60 minutes of appearing in LinkedIn's public listings, allowing for scheduler delays.
- **SC-002**: 0 duplicate alerts for the same job over any 30-day period.
- **SC-003**: At least 90% of alerts are judged relevant by the user (Angular / Angular-focused frontend, right seniority, right location or remote) over the first two weeks.
- **SC-004**: The user's LinkedIn account is never used. The project and its secrets contain no LinkedIn credentials.
- **SC-005**: The radar keeps running unattended for at least 60 days with no manual action.
- **SC-006**: The first run produces exactly 1 message, and no run produces more than 16 messages (15 individual alerts or 1 digest, plus at most 1 status message).
- **SC-007**: A new user can go from zero to receiving the first "Radar started" message in under 30 minutes by following the setup guide.
- **SC-008**: Running costs are $0 within the free tier of the hosting and messaging services used.

## Assumptions

- There is a single user (Abdelrahman), and alerts go to one private chat. Multi-user support is out of scope.
- The notification channel is a Telegram bot, and the scheduler/host is GitHub Actions on a public repository, as confirmed in docs/PLAN.md. The history file is saved back to that repository after each run.
- LinkedIn's public guest job listings stay reachable without login. If LinkedIn removes or blocks them, the radar stops finding jobs, and this is an accepted risk.
- LinkedIn has no separate "Lead" seniority level. Lead roles are usually tagged Mid-Senior, so Mid-Senior + Director covers them.
- LinkedIn's keyword matching is loose, so title filtering (not the search itself) decides relevance.
- A 24-hour search window combined with the seen-jobs history is enough to cover scheduler delays and skipped runs.
- Jobs requiring relocation are flagged, not removed, because wrongly dropping a true remote role costs more than an extra message.
- Applying to jobs, tracking applications, and scoring or ranking jobs beyond the filters above are out of scope.
