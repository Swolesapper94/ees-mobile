# MERIT Mobile Backend Handoff

The mobile application is a focused capture frontend for the existing MERIT system of
record. It should not own a separate database, identity system, evidence store,
or evidence-caption service.

## Intended production flow

1. Resolve the authenticated MERIT user from the same Supabase Auth session.
2. Fetch the user's active support form, current goals, and performance entries.
3. Create an `ACCOMPLISHMENT` support-form entry.
4. Upload the selected artifact into the existing protected Supabase Storage
   pipeline.
5. Create the `support_form_entry_artifacts` record with
   `aiCaptionStatus = PENDING`.
6. Return the entry immediately. The desktop and mobile frontends should both
   display `Processing`.
7. Process the artifact asynchronously and update the record to `COMPLETE` or
   `FAILED`.
8. Surface the same entry in the assigned rater's MERIT support-form view for
   independent confirmation, clarification, or non-use.

The assigned-rater lane is separate:

1. Discover current rater assignments through `GET /api/evaluations?role=rater`.
2. Select an evaluation's linked support form and rated Soldier.
3. Submit a direct factual observation through
   `POST /api/support-forms/:formId/observations`.
4. Keep the observation private to the assigned rater until it is discussed
   and released through counseling in the full MERIT workspace.

Senior raters may read observations and may review Soldier-submitted entries,
but the backend intentionally rejects observation creation by anyone other
than the currently assigned rater.

## Source-of-truth fields represented by the scaffold

- `support_form_entries.supportFormId`
- `support_form_entries.entryDate`
- `support_form_entries.section`
- `support_form_entries.entryType = ACCOMPLISHMENT`
- `support_form_entries.rawText`
- `support_form_entries.confirmationStatus = UNREVIEWED`
- `support_form_entry_artifacts.type`
- `support_form_entry_artifacts.fileUrl`
- `support_form_entry_artifacts.fileType`
- `support_form_entry_artifacts.aiCaption`
- `support_form_entry_artifacts.aiCaptionStatus`
- `support_form_entry_artifacts.flaggedByServiceMember`
- `support_form_entry_artifacts.flagNote`
- optional `goal_entry_links`

## Implemented integration seam

Implement only the two methods in `src/lib/ees-gateway.ts`:

```ts
interface EesGateway {
  bootstrap(): Promise<MobileBootstrap>;
  createEntry(draft: CaptureDraft): Promise<PerformanceEntry>;
}
```

Production mode maps these methods to the existing authenticated backend routes:

- `GET /api/users/me`
- `GET /api/support-forms`
- `GET /api/support-forms/:formId/goals`
- `POST /api/support-forms/:formId/entries`
- `POST /api/support-forms/:formId/entries/:entryId/artifacts`
- `GET /api/evaluations?role=rater`
- `POST /api/support-forms/:formId/observations`

The app reuses the standard Supabase browser session and the existing `devAuth`
header in development. It must be served under the same origin as MERIT web to
share browser session storage; a separate-origin deployment needs its own
Supabase sign-in shell rather than copying tokens between origins.

The likely production implementation will perform entry creation and binary
upload as separate requests. Preserve failure states explicitly:

- Entry created, upload pending
- Upload failed and retryable
- Artifact stored, caption pending
- Caption failed without deleting the original evidence
- Session expired
- Support form locked/finalized
- Unauthorized or out-of-relationship request

## Governance boundaries

- The rated Soldier may submit factual entries and evidence.
- Evidence does not calculate, recommend, or determine a rating.
- The assigned rater independently confirms, requests clarification, or marks
  an entry not used.
- Mobile does not grant rating, signature, acknowledgment, or evidence-
  confirmation authority.
- Actor, subject, timestamps, edits, and delegated actions must remain
  attributable in the EES audit log.
- The browser must never receive a Supabase service-role credential.

## Demo mode

With `VITE_EES_DEMO_MODE=true`, the app:

- persists structured entries in browser local storage;
- accepts real image/PDF selection;
- uses the device rear camera where supported;
- creates the entry immediately with a `PENDING` caption;
- transitions it to `COMPLETE` after a short delay;
- labels the generated description as a demo caption.

Demo mode intentionally does not upload bytes to a server or claim genuine
image analysis.
