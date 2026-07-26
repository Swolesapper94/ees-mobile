# MERIT Mobile

Mobile-first performance and evidence capture for MERIT.

This repository is a narrow MVP frontend: capture an accomplishment when it
happens, attach supporting evidence, disclose a possible record discrepancy,
and submit the entry for independent rater review. Assigned raters also receive
a separate lane for recording direct factual observations about their Soldiers.
It does not reproduce the full desktop evaluation workspace or transfer rating
authority to the rated Soldier.

## Capture and authority model

- **Rated Soldier:** submits self-reported accomplishments and evidence. Every
   entry starts `UNREVIEWED`; an authorized rater or senior rater must confirm
   it, request clarification, or mark it not used in the full MERIT workspace.
- **Assigned rater:** records direct factual observations for Soldiers they
   rate. These are rater-owned and private until discussed and released through
   counseling.
- **Senior rater:** may review Soldier-submitted entries and read observations,
   but does not author observations in place of the assigned rater.

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

- structured entries persist in browser local storage;
- image/PDF selection is real;
- the evidence record appears immediately as `Processing`;
- a clearly marked demo caption completes asynchronously;
- the performance-record timeline updates from the same client-side store.

This demonstrates the intended product flow but does not send files or records
to the MERIT platform while demo mode is enabled.

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

Production mode already maps the existing authenticated routes in
`src/lib/ees-gateway.ts`: active support-form lookup, goal lookup,
`ACCOMPLISHMENT` creation, multipart artifact upload, assigned-rater discovery,
and rater observation creation. It does not create a parallel mobile-only
backend contract.

During local development, the sign-in screen also offers Davis and Johnson
development identities. Those shortcuts use the backend's development-only
auth shim and are absent from production builds.

See `docs/BACKEND-HANDOFF.md` for the schema mapping, state model, and security
boundaries.

## MVP screens

1. Home / readiness
2. Accomplishment details
3. Evidence attachment and attestation
4. Submission confirmation
5. Performance record
6. Entry/evidence detail

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
