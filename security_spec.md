# ELDERCARE AI Security Specification (Hardened Multi-Member RBAC)

## 1. Data Invariants
1. **Identity & Verified Email Integrity**: Every user document `/users/{userId}` can only be read, created, or updated by the verified user (`request.auth.token.email_verified == true`) whose `request.auth.uid == userId`. No user can list `/users`. Global hardcoded admin overrides are prohibited.
2. **Master Gate Ownership & Membership**: All medical schedules, dose logs, appointments, SOS alerts, notification logs, and AI routines reside under `/careCircles/{circleId}/...` and require verified membership or ownership of the parent `careCircles/{circleId}` document.
3. **Invite-Gated Membership, Email Binding & No Self-Promotion**:
   - A non-owner can only read a `pending` `/circleInvites/{inviteCode}` if `invitedEmail` is empty or matches `request.auth.token.email`.
   - A non-owner can only join `/careCircles/{circleId}/members/{memberUid}` by redeeming a `pending` `/circleInvites/{inviteCode}` atomically in the same batch (`getAfter()`), locking `member.role == invite.invitedRole` and `acceptedByEmail == request.auth.token.email`.
   - Invited members cannot modify `members` roles or inject external UIDs into `memberUids`.
   - `/circleInvites` cannot be listed publicly (`allow list` restricted to verified `ownerId == request.auth.uid`).
4. **Role-Based Access Control (RBAC)**:
   - **Owner / Caretaker**: Full medication CRUD, appointment CRUD, missed-dose alert acknowledgement, dose logging, SOS acknowledgement/resolution, Care Circle profile updates (including clinical fields).
   - **Family**: Read-only access to medications, dose logs, and appointments; can update notification settings and emergency contacts (`elderPhone`, `emergencyContactName`, `emergencyContactPhone`, `notificationEmail`, `emailAlertsEnabled`, `missedDoseThresholdMinutes`), acknowledge/resolve Demo SOS events, log notifications, and save/delete AI routines. Cannot alter clinical demographics (`elderName`, `elderAge`, `bloodType`, `allergies`).
   - **Elderly**: Read access to schedule, appointments, and routines; can log/undo their own `pending`/`taken` doses (cannot overwrite `missed`/`skipped` logs or alter `alertAcknowledged`) with `±1` pill `stockCount` adjustment; can trigger Demo SOS alerts and record the linked `sos_demo` notification audit log when referencing an existing `sosEvents` document.
5. **Strict `memberUids` Synchronization & Departure Cleanup**:
   - On `careCircles` creation, `memberUids` must equal `[request.auth.uid]`.
   - On subcollection document creation, `memberUids` must match parent `careCircles/{circleId}.data.memberUids` (preventing cross-user workspace hijacking or outsider UID injection).
   - Departing members can remove only their own UID (`size - 1`, `hasAll`) from `memberUids` prior to deleting `/members/{uid}` so list access is revoked synchronously.
6. **Terminal State Locking & Server-Side API Authorization**:
   - Completed/cancelled appointments and resolved SOS events cannot be reopened.
   - Express APIs (`/api/notifications/*`, `/api/ai/routine`) fail-closed on missing project config, enforce `email_verified == true`, verify Care Circle membership/role against Firestore, restrict email targets to configured `notificationEmail` or the verified caller's own email (`test_setup` only), bound payload sizes, and apply per-user rate limits.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Reading `/careCircles/c1/medications/m1` with `auth == null`.
2. **Unverified Email Access**: Any read/write/list or API call when `request.auth.token.email_verified == false`.
3. **PII Cross-User Read**: User B attempting `get(/users/userA)` or reading an email-restricted pending invite for User A.
4. **Cross-User `memberUids` Poisoning**: User A creating a `careCircle` with `memberUids: [userA, userB]` or a subcollection doc with an outsider UID.
5. **Post-Revocation List Scraping**: A removed/departed member listing subcollection documents after membership revocation.
6. **Role Escalation / Self-Promotion**: Accepting a `family` invite with `role: 'caretaker'`, or updating `/members/{uid}` role as a non-owner.
7. **Unauthorized Medication / Clinical Mutation**: A `family` or `elderly` member creating/deleting medications or overwriting `bloodType`/`allergies`.
8. **Unauthorized Alert Acknowledgement or Missed-Log Overwrite by Elderly**: An `elderly` member updating `doseLogs.alertAcknowledged`, overwriting a `missed` log, or changing `stockCount` by more than `±1`.
9. **Forged `sos_demo` Notification Log by Elderly**: An `elderly` member creating a `notificationLogs` entry without a matching existing `sosEvents` document.
10. **Invite Replay or Email Spoof on Acceptance**: Reusing an `accepted`/`revoked` invite or setting `acceptedByEmail` to another user's email.
11. **Open Email Relay / Unscoped AI Prompt Abuse**: Calling `/api/notifications/send` or `/api/ai/routine` for a Care Circle the caller does not belong to, or sending alerts to an arbitrary third-party email.
12. **Terminal State & Unconfirmed SOS Bypass**: Reopening a `resolved` SOS event or writing `demoOnlyConfirmed: false`.
