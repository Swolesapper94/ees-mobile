# MERIT Mobile

Mobile-first performance and evidence capture for MERIT.

This repository is a narrow MVP frontend: capture an accomplishment when it
happens, attach supporting evidence, disclose a possible record discrepancy,
and submit the entry for independent rating-official review. Participants with
an authorized Soldier relationship also receive an observer lane for recording
direct factual observations. A leader remains a rated Soldier with a personal
record of their own; these capabilities are not mutually exclusive.

## Capture and authority model

- **Soldier:** submits self-reported accomplishments and evidence to their own
   record. Every
   entry starts `UNREVIEWED`; an authorized rater or senior rater must confirm
   it, request clarification, or mark it not used in the full MERIT workspace.
- **Leader / authorized observer:** has the Soldier capability above and may
   record direct factual observations for Soldiers in an authorized roster. In
   the current pilot backend, that roster is derived from formal rater
   assignments. Leaders may attach up to three images or PDFs. Observations
   and their evidence retain observer attribution and remain private until
   discussed and released through counseling.
- **Rating official:** reviews Soldier-submitted entries for the Soldiers in
   their rating relationship. This is a relationship, not a separate identity.
- **Pilot Owner:** sees aggregate adoption, speed, reliability, and workflow
   outcomes only. Pilot analytics do not grant operational access to personnel
   records, and Army rank does not grant pilot-analytics access.

Mobile captures source material. Review, counseling release, evaluation
authoring, and signatures remain in the full MERIT platform.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. For a phone-like desktop presentation, use the
rendered device frame. On an actual phone, the interface fills the screen and
the **Take photo** action opens the rear camera where the browser supports it.

## Demo behavior

The default demo mode is self-contained:

- a profile-based sign-in screen opens the Soldier, Leader, or Pilot Owner view;
- the persistent demo profile control switches views without a rebuild or separate URL;
- the Leader has both a personal record and an authorized observer lane with
  optional image/PDF evidence;
- only the Pilot Owner can open the private aggregate pilot-impact dashboard;
- unfinished drafts, including selected evidence blobs, persist in IndexedDB;
- image/PDF selection is real;
- upload and AI analysis use separate, explicit states;
- a clearly marked demo caption completes asynchronously;
- the performance-record timeline updates from the same client-side store.

This demonstrates the intended product flow but does not send files or records
to the MERIT platform while demo mode is enabled. Its staged records and
interaction state remain in the current browser only.

## Connect it to MERIT

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the same public
   Supabase project settings used by MERIT web. Mobile establishes and refreshes
   its own session, so it may be deployed on a separate origin.
2. Set `VITE_EES_API_URL` to the existing Express backend and include the
   mobile origin in the backend CORS configuration (`http://localhost:5173`
   for local development).
3. Run `npm run storage:ensure` in `ees2-backend` once per environment to
   provision the artifact bucket used by evidence uploads.
4. Set `VITE_EES_DEMO_MODE=false` and sign in through MERIT Mobile.
5. Verify that a mobile-created entry appears in the existing desktop rater
   workspace and that caption failure never removes the underlying artifact.

For the local Davis/Johnson acceptance route:

```bash
cd ../ees2-backend
node scripts/with-node22.mjs ./node_modules/.bin/tsx scripts/seed-mobile-demo.ts

cd ../ees2-frontend
./node_modules/.bin/playwright test tests/e2e/14-mobile-rater-loop.spec.ts --project=chromium
```

Production mode maps the existing authenticated routes in
`src/lib/ees-gateway.ts`: active support-form lookup, goal lookup,
`ACCOMPLISHMENT` creation, multipart artifact upload, assigned-rater discovery,
and rater observation/evidence creation. It does not create a parallel
mobile-only backend contract. Supabase Auth establishes the session; the
mobile app sends that token to the MERIT API, and the API owns access to
operational database records and private evidence. The browser never receives
a service-role key or writes directly to the protected tables.

During local development, the sign-in screen also offers Davis and Johnson
development identities. Those shortcuts use the backend's development-only
auth shim and are absent from production builds.

See `docs/BACKEND-HANDOFF.md` for the schema mapping, state model, and security
boundaries.

## MVP screens

1. Home / support-form status and goal-based readiness
2. Accomplishment details
3. Up to three image/PDF evidence attachments and attestation
4. Separate entry-save, evidence-upload, and analysis states
5. Performance record
6. Entry/evidence detail
7. Clarification note, correction, replacement evidence, and resubmission

## Entry and evidence policy

- Event dates must be within the active rating period and cannot be future-dated.
- Goals come only from the active support form and are filtered by leadership dimension.
- A discrepancy requires attached evidence and a written explanation.
- An assigned rater may attach image/PDF evidence to their own observation.
  It follows the observation's counseling-release boundary.
- JPEG, PNG, WEBP, HEIC/HEIF (when browser-decodable), and PDF are accepted; images are rotated, resized, re-encoded as JPEG, and stripped of metadata before upload.
- Entry creation is idempotent and guarded against double taps. Upload failure never removes the saved entry; analysis failure never removes secured evidence.
- Soldier entries are editable or withdrawable only while unreviewed. Clarification corrections increment the source version and preserve the original submission in audit history. Evidence used in an evaluation is locked.
- Artifact removal deletes the active database link but retains the storage object URL and caption snapshot in the immutable audit record pending a production retention schedule.

Before photo capture, the app warns against classified information, controlled operational material, medical records, and unnecessary personal information. This prototype is not accredited for live personnel data.

## Intentionally deferred

- Native iOS/Android shells
- Offline sync and conflict resolution
- Push notifications
- Audio/video capture
- Location tracking
- Peer reporting
- Automated scoring or rating recommendations
- Full rater workspace
- CAC/PKI integration

## Product chain

`Goal → observed accomplishment → supporting evidence → rater review → evaluation narrative`
