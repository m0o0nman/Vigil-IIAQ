# Firebase and Vercel deployment preparation

This runbook is for an isolated project during supervised acceptance testing. The selected services are Firebase Auth, Realtime Database, Firestore and Vercel Hobby.

## Create the Firebase project

1. In the Firebase console select **Add project**, choose an experiment project ID and complete setup on the **Spark** plan. In Project settings → General, add a Web app and copy its Firebase SDK config. Firebase Hosting is unnecessary.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**. In **Users**, create the single owner's account with a strong password, then copy that user's UID. In **Settings → Authorized domains**, add the specific local test host or eventual Vercel production host where required. The backend also verifies the ID token and explicitly checks the UID. Account possession alone does not grant owner access.
3. In **Build → Firestore Database**, create the **default** database in production mode. Use Standard edition where that selection is available. Record the location. In **Rules**, publish the contents of `web/firestore.rules` when authorized. Browser Firestore access remains denied. Import the field index exemptions from `web/firestore.indexes.json` before regular ingest to avoid indexing nested telemetry and working maps.
4. In **Build → Realtime Database**, create a locked-mode database in the intended region. Copy its complete instance URL from the Data tab. Publish the contents of `web/database.rules.json` under **Rules** when authorized. RTDB grants owner read access on the live, state, buffer and command trees. Normal browser writes are denied.
5. In **Project settings → Service accounts**, use an authorized server-only service account with access to read Firebase Auth users for revocation checks, transact in Firestore and publish RTDB. The default Admin service account can be used for the isolated experiment if approved. For least privilege, validate the designated account's IAM access for those operations. Under **Firebase Admin SDK → Generate new private key**, download its JSON on a trusted machine. Treat the entire file as sensitive.

The console can publish rules. The Firebase CLI can publish both rules files and the index exemptions from the tracked configuration. If already installed and authorized, run from `web\` with a project identity permitted to manage rules and indexes:

```powershell
$ProjectId = 'replace-with-your-firebase-project-id'
firebase login
firebase projects:list
firebase deploy --only 'firestore:rules,firestore:indexes,database' --project $ProjectId
```

Confirm the console shows the deployed Firestore and RTDB rules, the intended default database and the index exemptions. The last command mutates the selected Firebase project. [Firebase console](https://console.firebase.google.com/) · [CLI reference](https://firebase.google.com/docs/cli) · [Admin SDK credentials](https://firebase.google.com/docs/admin/setup)

## Environment variable map

Start with `web/.env.example`. Use `web/.env.local` for local work and the Vercel project's selected environment for an authorized release.

| Variable | Obtain it from | Store it in |
|---|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY | Web app SDK config `apiKey` | Public build setting |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | Web app SDK config `authDomain` | Public build setting |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | Web app SDK config `projectId` | Public build setting |
| NEXT_PUBLIC_FIREBASE_DATABASE_URL | RTDB Data tab, full HTTPS instance URL | Public build setting |
| FIREBASE_DATABASE_URL | Same RTDB instance URL | Server setting |
| VIGIL_OWNER_UID | Authentication → Users → owner UID | Server setting |
| FIREBASE_SERVICE_ACCOUNT_JSON | Full service-account key JSON, flattened to one line | Secret server setting |
| VIGIL_DEVICE_SECRET | Generate a unique random value and save it in a password manager | Secret server setting and identical device provisioning value |

For a new device secret, PowerShell can generate a 32-byte random value without displaying it. Paste it into the secret fields from the clipboard, then clear the clipboard after saving it to your password manager. Handle the service account key in a private editor or paste the JSON clipboard result into the secret field. Never store a secret in a NEXT_PUBLIC variable.

```powershell
$RandomBytes = New-Object byte[] 32
$Generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$Generator.GetBytes($RandomBytes)
$Generator.Dispose()
[Convert]::ToBase64String($RandomBytes) | Set-Clipboard
```

To place the Admin key on the clipboard as one-line JSON:

```powershell
Get-Content 'C:\private\firebase-admin-key.json' -Raw |
  ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress | Set-Clipboard
```

In a dotenv file, use a single-quoted one-line JSON value including its literal JSON backslash escapes in `private_key`. In Vercel enter the raw one-line JSON as the value without wrapping it in dotenv quotes. Clear the clipboard, protect or securely dispose of the downloaded file under the owner's credential policy, and revoke a key if exposed. Hosts with configured Application Default Credentials can omit the JSON setting. Local and cloud settings must point to the same intended project within each environment.

## Initialize and verify the data path

- Start the web app, sign in, and open Calibration or Settings. A successful owner status call exercises token verification and a Firestore read. A fresh project can show idle and no history. An initial RTDB permission error can occur until the first authorized projection sets `/access/owner`.
- The backend seeds `models/{name}` with active `v0` and `models/{name}/versions/v0` with the approved specs during its first model load. A successful first ingest or the authorized calibration-start path can trigger this. There is no separate seeding command. Do not create pointers in advance or seed the reconstructed MQ candidate.
- Use a supervised device and a separate acceptance project for the first authenticated ingest. Confirm HTTP 200 with matching boot ID and last sequence, `system/projection` in Firestore and `/live/latest` plus the correct owner mapping in RTDB. Check capture-minute documents as the minute boundary passes. In the dashboard, confirm one live observation and its timestamp. Use polling or the browser's network panel to observe subscription behavior instead of editing live documents from the console.
- Verify an unauthenticated ingest and owner route return 401 after environment configuration. A different authenticated UID should receive 403 from the owner API and permission denied from RTDB. Test with an authorized test identity in the acceptance project. Verify rules and data access in the Firebase console and through the application separately.

## Plan around the free quotas

The following are the owner-verified Phase 4 plan figures. The official Firebase quota, pricing and Vercel Hobby pages returned **HTTP 403** on Phase 6 recheck. Consult the same official documentation and the actual project usage panels before scheduling operation. These figures describe a four-hour/day experiment. Firmware acquisition and upload cadence remain unchanged.

| Resource | Planning estimate and owner-verified limit |
|---|---|
| Firestore operations | About 2,880 steady-state coordinator reads and 3,120 writes/day, including 240 completed minute writes. Limits are 50,000 reads, 20,000 writes and 20,000 deletes/day. Calibration, retries, exports, owner status polls and indexes add load. A representative calibration adds about 34 reads and 54 writes excluding owner calls. Each analytics refresh can read up to 60 archived minute documents plus coordinator/session records. |
| Firestore data | About 17.3 MB/day at the observed synthetic minute size, before index and encoding overhead. A 1 GiB storage allowance is approximately 62 experimental days at that rate. Estimated coordinator reads total 5.16 GiB of logical data per 30 days versus a 10 GiB outbound allowance. Logical size and billable transfer differ with region and overhead. |
| RTDB | About 1.23 GB of logical full projections per 30 days at the measured fixture size. The current projection is on the order of tens of KB. The owner verified 1 GB storage and 10 GB downloads/month. Subscriber fan-out, reconnects and transactions affect actual traffic. |
| Vercel Hobby | About 86,400 ingest requests per 30 days before owner calls and retries. The owner verified 1 million monthly invocations, 4 active CPU hours and 360 GB-hours provisioned memory. The invocation estimate permits roughly 167 ms average active CPU per ingest before other work. Measure actual CPU and duration in the project. |

Retained history eventually exceeds finite storage. TTL is a billed feature and the project uses no TTL or automatic deletion. Set experiment dates and review retention with the owner. This estimate does not validate plan eligibility, actual throughput or quotas for a deployed instance. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) · [Firebase pricing](https://firebase.google.com/pricing/) · [Vercel Hobby](https://vercel.com/docs/plans/hobby) · [Phase 4 budget derivation](phase4_calibration.md#four-hour-experimental-quota-scenario)

## Configure Vercel after authorization

1. Confirm the approved release commit is present in the authorized GitHub repository. The Phase 6 branch is local at handoff. When authorized to start deployment, open Vercel → **Add New → Project**, connect the GitHub installation with access to the repository, and import it.
2. Select the **Next.js** preset and set **Root Directory** to `web`. Enable access to source files outside the root if the Vercel project exposes that setting. The application imports the repository's `training/specs` and `inputs/brand/colours/colours.json`. Set Node.js 24.x if offered. Set **Install Command** to `npm ci` and **Build Command** to `npm run build`. Keep the Next.js output defaults.
3. Add every variable in the map to the intended Vercel environment. Set the approved branch as the Production Branch in project settings. Keep the firmware URL pointed at the intended production hostname and public root, once verified. Public settings are bundled at build time. Rebuild or redeploy after changing them.
4. Start **Deploy** only after approval. After it succeeds, use the canonical HTTPS production URL, with no redirect, followed by `/api/ingest`. The device has no Vercel login token. Confirm protection settings allow that route to reach its existing device-secret check. The browser and API continue to enforce Firebase authorization.
5. Verify the home page and the logo/font requests, check sign-in for the owner and denied access for a nonowner test identity, and exercise the credential and data-path checks above. Inspect build and function logs without logging tokens or request secrets. Confirm the device receives the firmware's exact response contract across the deployed HTTP path, including a compact uncompressed body, matching ACK and Content-Length. Record the actual commit, URL and verification date.
6. If the build reports missing training specs, brand tokens or the bundled Syne font, verify that the build includes the complete checkout and rerun it. Redeploying the prior Vercel commit does not restore Firebase calibration pointers. Use the approved owner rollback control for a model rollback. [Vercel monorepo roots](https://vercel.com/docs/monorepos) · [Troubleshooting](troubleshooting.md)

Phase 6 did not perform a Firebase or Vercel deployment.
