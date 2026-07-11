# Credential history cleanup

This is an operator runbook, not an automatic migration. Do not run the destructive steps from a working clone, and never paste a credential into an issue, commit, chat, command line, or replacement file.

## Confirmed historical scope

The public repository historically tracked `ai_context.txt`. Commit `c1cb50917a42714a100de72cdb480960370df1f2` introduced credentials in that file on 2025-07-19. Commit `433839e576815b9d8407570cc9751d4d087fc177` later deleted the file, but deletion did not remove its earlier blobs from Git history.

The retired production test email and password also appeared in `backend/tests/api.test.js` and `backend/tests/lifecycle.test.js`, beginning in initial commit `19ee62668c875582c1355ce75300642a24c9e288`. Commit `1fa00bef082f02672802046390c4ebd9f0f6c545` changed both tests to environment-driven configuration, but their older blobs still require redaction.

The file contained these credential classes:

- a Render PostgreSQL connection URL;
- the JWT signing secret;
- the private AI-route secret;
- an old admin secret; and
- a production test-login password for an account that has since been deleted.

Provider-format OpenAI, Anthropic, Google, Groq, SendGrid, Resend, and ElevenLabs keys were not found in reachable tracked history during the 2026-07-10 audit. Re-check with Gitleaks before relying on that result.

The owner reported that the repository had no forks, one collaborator, and GitHub secret scanning plus push protection enabled at audit time. Re-check all four facts immediately before rewriting history. A non-destructive rehearsal on 2026-07-10 removed every known value across 345 commits and changed 15 branch refs, one tag, and 41 pull-request refs.

## 1. Contain and rotate first

History cleanup cannot make an exposed credential trustworthy again. Complete rotation before rewriting Git:

1. Replace the Render PostgreSQL credential. Update the backend service and local development environment, restart the service, verify `/health`, then revoke the old database credential.
2. Generate and deploy a new `JWT_SECRET`. This intentionally invalidates every existing 90-day login token, so users will need to sign in again.
3. Generate and deploy a new `AI_SECRET_KEY` as immediate containment. The unused private AI-tool route is retired by this hardening batch; remove the variable after that code is live.
4. `ADMIN_SECRET` is not referenced by current application source and has been removed from the production environment.
5. Confirm the retired production test account is still absent. Never reuse its old password for another account or service.
6. Review provider dashboards for unexpected usage. Provider API keys did not appear in tracked history in this audit, so rotate them only if provider logs or another exposure path warrants it.

Store deployment values in Render's environment settings. For local development, keep `.env` files ignored and access-restricted; prefer a location that is not cloud-synced or backed up as plaintext.

## 2. Prepare a coordinated maintenance window

- Freeze pushes and merges until cleanup is complete.
- Finish or intentionally abandon open work. Record every branch and tag that must survive.
- Re-check forks, collaborators, open pull requests, releases, Actions artifacts, and branch protection.
- Make an encrypted, offline emergency backup. It still contains the exposed credentials and must be destroyed after verification.
- Install `git-filter-repo` version 2.47 or newer. That is the minimum version with `--sensitive-data-removal`.

Every descendant commit ID will change. Pull requests may need to be recreated, commit and tag signatures will no longer validate, cached commit links may break, and branch protection may need to be temporarily relaxed. The tag `pre-makeover-2026-06-11` and every affected branch must be included.

## 3. Rewrite a fresh clone

Use a new directory outside the normal project folder. Do not add `--force` to the filtering command; the fresh-clone safety check is useful.

The remote currently contains both `Stage` and `stage`. On Windows, create the clone under a case-sensitive directory (or perform the rewrite on Linux/macOS); otherwise `git-filter-repo` correctly refuses to risk collapsing those refs:

```powershell
$cleanupRoot = Join-Path $env:TEMP 'sluff-history-cleanup'
New-Item -ItemType Directory -Path $cleanupRoot
fsutil file setCaseSensitiveInfo $cleanupRoot enable
git clone https://github.com/mmcmillan1999/sluff-project.git (Join-Path $cleanupRoot 'repo')
Set-Location (Join-Path $cleanupRoot 'repo')
git filter-repo --sensitive-data-removal --invert-paths --path ai_context.txt --replace-text scripts/history-redactions.txt
```

Removing the whole historical context file avoids placing its raw credentials in a replacement-text file or shell history. The tracked replacement-expression file contains only a regex and safe placeholder; it removes quoted historical `TEST_USER_PASSWORD` values while preserving the two test files. If the context file is later found under another historical path, repeat the clone and include an additional `--path` for every path in one filter operation.

Inspect the rewrite before publishing it:

```powershell
git log --all -- ai_context.txt
Get-Content .git/filter-repo/first-changed-commits
Get-Content .git/filter-repo/changed-refs
pwsh -File scripts/scan-secrets.ps1 -AllHistory
```

The first command must return no commits. Review the changed-ref report carefully, especially any `refs/pull/*` entries. Confirm the old test email and password no longer match anywhere in history without printing either value. Gitleaks findings are redacted; investigate any finding without copying its value.

## 4. Publish only after explicit approval

The following operation replaces remote history. Re-add the remote if `git-filter-repo` removed it, temporarily allow force pushes where required, and execute only after the owner approves the reviewed ref map:

```powershell
git remote add origin https://github.com/mmcmillan1999/sluff-project.git
git push --force --mirror origin
```

Repeat until every intended branch and tag is updated and the only expected push failures are GitHub's read-only `refs/pull/*` refs. Do not casually delete a remote branch just because it was absent from the cleanup clone.

## 5. Finish removal on GitHub and other copies

1. Open a GitHub Support request for sensitive-data removal. Supply the repository, affected pull-request refs from `changed-refs`, and the first changed commit. Ask GitHub to purge cached views and unreachable pull-request references.
2. Re-enable branch protections and push protection.
3. Re-run the secret-scan workflow and the full application CI suite.
4. Delete or freshly clone every local copy. Never merge an old branch into the rewritten repository; that can reintroduce the exposed objects.
5. Re-check that no fork appeared during the maintenance window.
6. Destroy the encrypted tainted backup once the rewrite and GitHub Support cleanup are verified.
7. Monitor database, authentication, AI-route, and provider logs for suspicious activity.

GitHub's current sensitive-data removal guidance is the authority for the final procedure: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>.

## Prevention

- GitHub secret scanning and push protection remain enabled.
- `.github/workflows/secret-scan.yml` scans pushes and pull requests with a pinned Gitleaks action.
- `.gitleaks.toml` extends Gitleaks' maintained defaults with Sluff-specific environment and PostgreSQL URL rules.
- Before committing, run `pwsh -File scripts/scan-secrets.ps1`. Use `-AllHistory` for periodic full-ref audits.
- Never commit generated context dumps, production login details, database URLs, or plaintext backup files.
