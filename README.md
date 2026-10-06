# MergeMint

> **Decentralized Bounty Escrow & Work Verification Protocol on Canton Network**  
> Move tokenized value on Canton from open-source sponsors to contributors upon verified GitHub pull request delivery, protected by exact-commit revision pinning and CIP-56 Holding-compatible token settlement.

[![Tests](https://img.shields.io/badge/tests-52%20passed-58cba8.svg)](#quality-gate)
[![Canton Live](https://img.shields.io/badge/Canton%20LocalNet-Live%20Participant-58cba8.svg)](#canton--daml-architecture)
[![Token Standard](https://img.shields.io/badge/CIP--56-HoldingV1%20Compatible-38bdf8.svg)](#level-c--cip-56-holding-compatible-token-standard)
[![AI Engine](https://img.shields.io/badge/Scout%20AI-Groq%20%7C%20Llama--3.3--70b-eab308.svg)](#scout-ai-autonomous-codebase-scout)

---

## Visual Walkthrough & Product Stages

MergeMint connects GitHub repository work with atomic Canton token escrow. Below are the key stages of the protocol in action:

### 1. Scout AI · Autonomous Work Discovery
*Scout analyzes repository code architecture, missing retry logic, token interfaces, and tests to propose actionable fundable work with source evidence and acceptance criteria.*
![Scout AI Discovery](docs/screenshots/01_scout_discovery.png)

---

### 2. Maintainer Workspace Dashboard
*Real-time visibility over active bounties, pending PR reviews, token allocations, and ledger synchronization.*
![Dashboard Overview](docs/screenshots/02_dashboard_overview.png)

---

### 3. Step 1: Repository Selection
*Connected GitHub repositories with real issue counts and instant search filtering.*
![Repository Selection](docs/screenshots/03_repo_selection.png)

---

### 4. Step 2 & 3: Define Terms & Acceptance Criteria
*Configure bounty rewards in MergeMint Token (MMT) with verifiable acceptance criteria.*
![Bounty Terms & Criteria](docs/screenshots/04_bounty_terms_criteria.png)

---

### 5. Step 4: Review & Fund on Canton
*Pre-flight summary before locking token holdings in on-chain escrow on Canton LocalNet.*
![Review & Fund](docs/screenshots/05_fund_canton_escrow.png)

---

### 6. Bounty Detail & Lifecycle State Machine
*Lifecycle tracking: Draft → Funded → Claimed → Submitted → Approved → Settled.*
![Bounty Detail Tracking](docs/screenshots/06_bounty_detail_tracking.png)

---

### 7. Pull Request & CI Evidence Drawer
*Links GitHub PRs, binds exact head commit SHAs, and validates CI test runs. Revisions reset approval if commit SHAs change.*
![PR & CI Evidence Drawer](docs/screenshots/07_pr_ci_evidence.png)

---

### 8. Canton Settlement Receipt & CIP-56 Token Transfer
*Atomic settlement releases locked tokens directly to the contributor holding contract on the Canton participant ledger.*
![Canton Settlement Receipt](docs/screenshots/08_canton_settlement_receipt.png)

---

## Core Pillars & Architectural Story

```
┌─────────────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
│      1. Scout AI        │       │  2. Canton Escrow      │       │  3. Revision Pinning   │
│ Inspects code, manifest │       │ Locks CIP-56 token     │       │ Binds exact PR commit  │
│ & tests via Groq LLM    ├──────►│ holdings in Daml       ├──────►│ SHA + verifies CI test │
│ Proposes fundable tasks │       │ contract on LocalNet   │       │ runs before approval   │
└─────────────────────────┘       └────────────────────────┘       └───────────┬────────────┘
                                                                               │
                                                                               ▼
                                  ┌────────────────────────┐       ┌────────────────────────┐
                                  │   5. CIP-56 Settlement │       │  4. Maintainer Review  │
                                  │ Atomic token transfer  │◄──────┤ Authorizes completion  │
                                  │ to contributor holding │       │ for exact revision     │
                                  └────────────────────────┘       └────────────────────────┘
```

### A. Scout AI Autonomous Codebase Scout
- **Targeted Bounded Analysis**: Inspects repository tree, manifest files, README excerpts, and 3–5 targeted code files (source, error handling, tests, config) bounded to <12 KB for sub-second latency.
- **Provider**: Server-side Groq Cloud API powered by `llama-3.3-70b-versatile` in JSON mode.
- **Evidence-Backed**: Every proposal includes specific file paths, module name, and trigger reason (e.g., *"Direct HTTP fetch calls without exponential backoff"*).
- **Honest Signals**: Replaces uncalibrated percentages with qualitative badges (`Strong signal`, `Medium signal`, `Exploratory`).
- **Engine Transparency**: Unmistakable engine badge (`✦ Groq AI` vs `⚠ Heuristic fallback`). Never silently misrepresents fallback logic.
- **Maintainer Authority Invariant**: Scout proposes only. It never unilaterally creates GitHub issues or locks escrow funds.

### B. Level C — CIP-56 Holding-Compatible Token Settlement
- **Official Interface**: Implements the official Splice Holding interface:
  ```daml
  package Splice.Api.Token.HoldingV1 (718a0f...);
  interface Holding where ...
  ```
- **Live Canton Participant**: Deploys `MergeMint.Token:MergeMintHolding` to a running Canton participant node (`http://127.0.0.1:7575`).
- **Atomic On-Ledger Settlement**: Maintainer approval exercises `Settle` on `MergeMintBounty`, consuming the escrow contract and transferring MMT holdings directly to the contributor party.
- **Full Traceability**: Every settlement produces a cryptographic receipt holding:
  - `tokenRecipientHoldingId` (transferred CIP-56 Holding contract ID)
  - `settlementRef` (Canton transaction identifier)
  - `approvedSha` (cryptographically pinned commit SHA)
  - `settledAt` (ledger timestamp)

### C. State Machine & Revision Pinning Guarantees
```
DRAFT → FUNDED → CLAIMED → SUBMITTED → APPROVED → SETTLED
```
1. **Sponsor & Maintainer Separation**: Separate Daml parties ensure fund providers cannot unilaterally approve their own PRs without maintainer sign-off.
2. **Revision Pinning**: Linking a PR binds its head commit SHA (`abc1234...`). If a contributor pushes new commits to the branch, prior AI reviews and approvals are **immediately invalidated** and reset to `SUBMITTED`.
3. **No Unapproved Settlement**: Daml contract choices strictly prevent settlement if the submission SHA does not match the approved SHA.

---

## Quick Start & Local Setup

### Prerequisites
- **Node.js**: v20.9 or newer (v22 / v24 tested)
- **Canton**: (Optional for local live node; mock mode is available zero-config)

```sh
# Clone & install dependencies
git clone https://github.com/grzdev/mergemint.git
cd mergemint
npm install
```

### 1. Run in Mock Mode (Zero-Config, Instant Demo)
```sh
npm run dev
```
Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Runs with simulated GitHub repositories, pull requests, CI check runs, and Canton ledger state.

### 2. Run with Live Canton LocalNet & Real GitHub Mode
Create `.env.local` in the project root:

```ini
# --- GitHub App Configuration ---
GITHUB_INTEGRATION_MODE=real
GITHUB_APP_ID=your_github_app_id
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_SLUG=your-app-slug
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
SESSION_SECRET=your_random_32_char_secret

# --- Canton Participant Configuration ---
CANTON_INTEGRATION_MODE=real
CANTON_LEDGER_API_URL=http://127.0.0.1:7575
CANTON_NETWORK="Canton LocalNet"
CANTON_PACKAGE_ID=396bbb895702f963211ab2a69a2b74b53170e513876978af6ddfc7636c217258
CANTON_SPONSOR_PARTY=sponsor::12209fb2602be0c2088b9fec48802b55fd39a3413090f039c0dfbfe382e783854c0b
CANTON_MAINTAINER_PARTY=maintainer::12209fb2602be0c2088b9fec48802b55fd39a3413090f039c0dfbfe382e783854c0b
CANTON_CONTRIBUTOR_PARTY=contributor::12209fb2602be0c2088b9fec48802b55fd39a3413090f039c0dfbfe382e783854c0b

# --- Scout AI Configuration ---
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

Start the application:
```sh
npm run dev
```

---

## Quality Gate & Verification

```sh
# Run domain, state machine, and Scout test suites (52 passing tests)
npm test

# Run live Canton participant on-ledger integration test
npm run test:canton-live

# Run TypeScript type check
npm run typecheck

# Run production Next.js build
npm run build
```

---

## Repository Structure

```
├── daml/                          # Daml smart contracts
│   ├── MergeMint/
│   │   ├── Bounty.daml            # Core MergeMintBounty & SettledReceipt templates
│   │   └── Token.daml             # CIP-56 HoldingV1 implementation for MMT
│   └── daml.yaml                  # Daml package definition with Splice DAR dependencies
├── docs/
│   └── screenshots/               # Step-by-step visual product tour
├── src/
│   ├── app/                       # Next.js App Router & server-side API routes
│   │   ├── api/canton/            # Server endpoints for Canton JSON Ledger API v2
│   │   ├── api/github/            # GitHub App OAuth & REST proxies
│   │   └── api/scout/discover/    # Server-only Scout LLM endpoint (zero key leak)
│   ├── components/                # Progressive disclosure UI components (Modal, Drawer)
│   ├── domain/                    # Pure domain models, state machines & invariants
│   │   ├── bounty.ts              # Bounty lifecycle state machine
│   │   ├── createBounty.ts        # Stepper validation rules
│   │   └── scout.ts               # Scout opportunity schema & evidence types
│   ├── features/                  # UI flows
│   │   ├── bounties/              # Dashboard, detail views, creation flow
│   │   └── scout/                 # Scout AI discovery drawer
│   └── integrations/              # External service adapters
│       ├── ai/                    # Groq client & bounded repo context collector
│       ├── canton/                # Canton JSON Ledger API participant adapter
│       ├── daml/                  # CIP-56 Holding interface decoder & serializers
│       └── github/                # GitHub App client, checks & PR mapper
```

---

## License

Apache 2.0. Built for the HackCanton Hackathon.
