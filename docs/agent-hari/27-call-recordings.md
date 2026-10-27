# 27. Call Recordings: Listen, Download, Auto-Delete

## 1. What it does

Every call is recorded by Plivo. In a call's conversation page an **Admin** or the **Owner** can play the recording, download it, and see how long it stays available. Every recording is **permanently deleted 30 days after the call ended**. The transcript, summary and screening result are kept; only the audio is removed.

Code: `services/recording_service.js` (one place for access, expiry, streaming and deletion).

---

## 2. Who can listen and download

| Role | Access |
|------|--------|
| Admin | Their own calls (directly, or through their contact sheet) and unassigned calls, after signing in. `/api/admin/conversations/:id/audio` and `/recording-info`. |
| Owner | Every call, from the owner panel. `/api/owner/conversations/:id/audio` and `/recording-info`. |
| End user, everyone else | No access. There are no public or shareable links. |

- A call that is not the admin's answers "Conversation not found", the same as a call that does not exist.
- `?download=1` on the audio route sends the file as `<contact>_<call date>.mp3`.
- Seeking works (HTTP Range). Our Plivo credentials are sent to Plivo only, never to the storage address Plivo redirects to.
- Only `https` links on `plivo.com` are saved or streamed. A local file path is never read.

---

## 3. The 30-day rule

- The expiry date is **call end + 30 days** (`recording_expires_at`). If the end time is unknown: call start + duration, then the row's own date.
- The date is stamped when the recording callback arrives, when the conversation is saved, and, for recordings that already existed, by the daily job.
- The rule is enforced when someone opens a recording, so it holds even before the job runs: after the date the audio route answers `410` ("Recording expired (30-day limit)") and the page shows that text.
- **Daily job** (`RecordingService.startMaintenance`, started in `server.js`; first run one minute after start):
  1. stamps any recording that has no expiry date,
  2. deletes each expired recording at Plivo (`DELETE /Recording/<id>/`; "already gone" counts as deleted),
  3. clears the link on the conversation and contact and sets `recording_deleted_at`.
- If Plivo fails, the link is kept (playback is already refused) and the deletion is tried again the next day. If Plivo is not configured, the job does nothing.
- The log has counts only: `Cleanup finished: N deleted, M failed (will retry)`.
- **Deletion cannot be undone.** Anyone who needs a recording for longer must download it within 30 days.

---

## 4. Reliability

- **Start with retry**: `PlivoService.startCallRecordingWithRetry` tries up to 3 times (1.5 s and 4 s apart) because the call may not be live at Plivo yet when the answer webhook fires. It runs in the background and never delays the call.
- **Missed callbacks**: every 30 minutes `RecordingService.reconcileMissing` asks Plivo for the recording of calls that ended 5 minutes to 6 hours ago and have no link. Opening a recording does the same lookup for one call.
- **Right call only**: the recording callback updates the conversation and contact of that call (matched by `provider_call_id`), never every conversation of the contact. A late callback for an earlier attempt does not replace a newer call's link.
- **Logging**: `Recording saved`, `Recording link recovered`, `Call ... could not be recorded after N attempt(s)`.

---

## 5. Data

| Column | Table | Meaning |
|--------|-------|---------|
| `recording_url`, `recording_id` | `conversations`, `contacts` | Plivo link and id (already existed) |
| `recording_expires_at` | `conversations`, `contacts` | ISO date: call end + 30 days |
| `recording_deleted_at` | `conversations` | When the audio was deleted |

The columns are added automatically at start-up (`ensureRecordingSchema` in `services/db.js`).

---

## 6. Open points

- Legal sign-off on the call-recording disclosure and consent wording for the regions we call.
- The privacy page (`privacy.html`) states the 30-day rule; its wording is pending the same review.

---

## 7. Tests

`node tests/call_recordings.test.js`. It uses an in-memory database and a fake Plivo, so it never touches the real database or phone provider. It needs Node 22+ (or `better-sqlite3`) and skips otherwise.
