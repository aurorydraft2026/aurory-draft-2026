# ASGARD DUELS — DAOry Grant Proposal

## Community-Built Competitive Platform for Amiko Legends

---

**Submitted to:** Aurory DAOry  
**Submitted by:** Asgard Duels Team  
**Date:** March 2026  
**Version:** 1.0

---

## TABLE OF CONTENTS

1. Executive Summary
2. Problem Statement — The Current State Issue
3. The Solution — Why Asgard Duels?
3. The Solution — Why Asgard?
4. Target Audience
5. Platform Features
6. Roadmap & Future Plans
7. Budget Request & Justification
8. Team
9. Monthly Data Tracking Report Template
10. Appendix — Draft Mode Reference

---

## 1. EXECUTIVE SUMMARY

**Asgard** is a community-built competitive drafting and tournament management platform for **Amiko Legends** (formerly Seekers of Tokane) — the flagship tactical turn-based game in the Aurory ecosystem on Solana. The platform enables organized, rules-based competitive play through multiple draft formats, automated match verification via the Aurory API, and integrated AURY token economics.

Since its inception, Asgard has served as the primary third-party competitive infrastructure for the Aurory community, providing tournament organizers and players with the tools needed to run structured, fair, and verifiable competitive events.

This proposal requests funding from the DAOry treasury to sustain ongoing development, expand the platform's capabilities, and grow the competitive community around Amiko Legends.

---

## 2. PROBLEM STATEMENT — THE CURRENT STATE ISSUE

### The Challenge in Amiko Legends

Amiko Legends offers deep tactical gameplay with 30+ unique Amikos across six elements, but the game currently **lacks a native competitive structure** for organized play. The key issues are:

- **No official draft system.** Players who want to compete in organized formats (especially team-based 3v3) have no in-game tooling to manage team composition, enforce unique picks, or structure turn-based draft phases.

- **No match verification infrastructure.** There is no built-in mechanism to verify that players used their drafted lineups in actual battles, creating opportunities for cheating in competitive events.

- **No tournament management tools.** Community organizers must resort to spreadsheets, Discord bots, or manual coordination to run tournaments — a process that is error-prone, time-consuming, and unscalable.

- **No competitive leaderboard.** Without persistent match tracking and performance data, there is no way to recognize top players, measure community engagement, or build a competitive metagame.

- **No entry-fee / prize-pool systems.** Community-run tournaments lack a standardized way to collect entry fees, manage prize pools, or integrate with the AURY token economy.

### What This Means for the Ecosystem

Without competitive infrastructure, the Aurory community misses out on:

- **Player retention** — competitive play is a proven driver of long-term engagement.
- **AURY token utility** — tournaments with entry fees create organic demand for the token.
- **Community growth** — a vibrant competitive scene attracts new players and content creators.
- **Ecosystem visibility** — organized esports-style events generate attention within the broader Solana gaming space.

---

## 3. THE SOLUTION — WHY ASGARD DUELS?

Asgard Duels directly addresses every gap identified above with a purpose-built web application.

### Core Capabilities

| Problem | Asgard Duels Solution |
|---|---|
| No draft system | 4 distinct draft modes (1v1 and 3v3) with enforced rules, timers, and turn-based pick orders |
| No match verification | Aurory API integration for automated lineup and match result verification |
| No tournament tools | Full tournament lifecycle management — creation, team assignment, coin flip, drafting, scoring |
| No leaderboard | Persistent leaderboard with monthly/all-time rankings, filterable by mode |
| No token economy integration | AURY entry fees, wallet integration, automated prize distribution |

### What Makes Asgard Duels Unique

1. **Community-native.** Built by players, for players. The platform reflects the actual competitive needs of the Aurory community.

2. **Real-time & interactive.** Live draft sessions with animated coin flips, phase-based picking, blind ban phases, and countdown timers create an engaging spectator and participant experience.

3. **Fully verifiable.** Every match result is cross-referenced against the Aurory API, ensuring competitive integrity.

4. **AURY-integrated.** Entry fees and prize pools use the native AURY token, creating organic utility and demand.

5. **Free and accessible.** Players can host both friendly (free) and competitive (entry fee) drafts, lowering the barrier to entry.

---

## 4. TARGET AUDIENCE

### Primary Audience

- **Active Amiko Legends players** — Existing players looking for structured competitive play beyond casual matches.
- **Aurorian NFT holders (DAOry members)** — Community leaders and content creators who organize events and drive engagement.
- **Tournament organizers** — Community members looking for tools to host and manage competitive events.

### Secondary Audience

- **New players** — A competitive scene serves as a funnel providing a reason for new players to join the ecosystem.
- **Content creators & streamers** — Draft events create compelling content opportunities (live drafts, tournament coverage).
- **Solana gaming community** — Asgard Duels showcases Aurory's competitive potential to the broader blockchain gaming audience.

### Community Size

The Aurory ecosystem includes:
- Thousands of Aurorian NFT holders in the DAOry
- Active Discord community in the official Aurory channels
- Growing competitive player base within Asgard Duels

---

## 5. PLATFORM FEATURES

### Draft Modes

| Mode | Format | Description |
|---|---|---|
| **Mode 1** — Triad Swiss Standard | 3v3 | Teams of 3 take turns drafting 9 Amikos each in a balanced pick order (3-6-6-3), with a blind simultaneous ban phase |
| **Mode 2** — Triad Swiss Alternate | 3v3 | Alternate 3v3 draft with granular pick rotation (1-2-2-2-2-2-2-2-2-1) for deeper tactical play |
| **Mode 3** — 1v1 Random Pool Draft | 1v1 | Each player receives a randomized 8-Amiko pool and simultaneously picks 3, creating unpredictable matchups |
| **Mode 4** — 1v1 Ban Draft | 1v1 | Advanced turn-based format with 6 bans (1-2-2-1) followed by 6 picks (1-2-2-1), featuring coin flip advantage, and element-restriction rules |

### Key Features

- **Coin Flip System** — Animated 3D coin flip with team leader confirmation and advantage selection (1st Ban vs 1st Pick)
- **Blind Ban Phase** — Simultaneous, hidden ban selection in 3v3 modes ensuring strategic surprise
- **Timer System** — Configurable countdown timers with manual/auto-start, per-turn, or shared timer options
- **Leaderboard** — Monthly and all-time rankings filterable by draft mode with historical data
- **Match History** — Persistent record of all matches, results, and player performance
- **AURY Entry Fees** — Token-based entry fee system with wallet balance checking and automated collection
- **Match Verification** — Aurory API integration that verifies battle lineups and results on-chain
- **Private Battle Codes** — Automated generation of in-game battle codes for verified matches
- **Mobile Responsive** — Fully optimized for desktop and mobile devices
- **Real-time Updates** — Firebase-powered live synchronization across all connected clients
- **Admin Panel** — Tournament management tools for organizers (timer control, manual overrides, scoring)
- **Major Announcements** — In-app announcement system for community updates

### Technical Stack

| Component | Technology |
|---|---|
| Frontend | React.js |
| Backend | Firebase (Firestore, Auth, Cloud Functions) |
| Authentication | Discord OAuth + Google Auth |
| Hosting | Firebase Hosting |
| Blockchain | Solana (AURY token integration) |
| API Integration | Aurory Game API |

---

## 6. ROADMAP & FUTURE PLANS

### Phase 1 — Foundation (Completed ✅)

- ✅ Core draft system with 4 modes
- ✅ Real-time multiplayer draft sessions
- ✅ Coin flip and team assignment system
- ✅ Timer system (auto/manual)
- ✅ Match history and leaderboard
- ✅ AURY entry fee integration
- ✅ Mobile-responsive design
- ✅ Admin panel for tournament management
- ✅ Ban phase implementation (3v3 blind + 1v1 turn-based)

### Phase 2 — Growth & Competitive Features (Q2 2026)

- [ ] Tournament bracket system (Round Robin, Single Elimination, Swiss)
- [ ] Automated tournament scheduling with recurring events
- [ ] Advanced analytics dashboard (win rates, Amiko meta analysis, player stats)
- [ ] Spectator mode with live draft viewing for non-participants
- [ ] Player profiles with match history, badges, and achievements
- [ ] Discord bot integration for draft notifications and results
- [ ] Push notifications for match invitations and results

### Phase 3 — Ecosystem Expansion (Q3–Q4 2026)

- [ ] Season system with competitive ladders and seasonal rewards
- [ ] NFT badge rewards for tournament winners (Solana NFTs)
- [ ] Streaming integration (Twitch/YouTube overlays for draft events)
- [ ] Advanced AURY prize pool distribution (multi-tier payouts)
- [ ] API for third-party integrations
- [ ] Multi-language support
- [ ] Community-suggested draft modes and custom rulesets

### Phase 4 — Sustainability (2027+)

- [ ] Self-sustaining revenue model via platform fees on competitive drafts
- [ ] Community governance for rule changes via DAOry proposals
- [ ] Partnership with other Solana gaming projects for cross-game tournaments

---

## 7. BUDGET REQUEST & JUSTIFICATION

### Total Requested: [AMOUNT TO BE DETERMINED BY USER] AURY

Below is a breakdown of costs by category. All figures are estimated and should be finalized by the team.

#### 7.1 Development Costs

| Item | Monthly Cost (USD) | Duration | Total | Justification |
|---|---|---|---|---|
| Lead Developer (Full-stack) | _[TBD]_ | 6 months | _[TBD]_ | Sole developer building and maintaining the entire platform. Responsible for frontend (React), backend (Firebase), API integrations (Aurory/Solana), and DevOps. |
| Cloud Hosting (Firebase) | ~$50–150/mo | 6 months | ~$300–900 | Firestore reads/writes, Cloud Functions execution, hosting bandwidth. Scales with user activity. |
| Domain & CDN | ~$20/mo | 6 months | ~$120 | Custom domain, SSL, CDN for asset delivery. |

#### 7.2 Community & Marketing

| Item | Monthly Cost (USD) | Duration | Total | Justification |
|---|---|---|---|---|
| Community SMM (Social Media Manager) | _[TBD]_ | 6 months | _[TBD]_ | Manages social media presence, community engagement, event promotion, and content creation to grow the competitive player base. |
| Tournament Prize Pools | _[TBD]_ per event | Ongoing | _[TBD]_ | AURY prize pools to incentivize participation and attract new players. Critical for community growth. |
| Promotional Materials | _[TBD]_ | One-time | _[TBD]_ | Graphics, video content, and promotional assets for events and social media. |

#### 7.3 Operational Costs

| Item | Cost (USD) | Justification |
|---|---|---|
| Aurory API Access | $0 (currently free) | API integration for match verification. May need dedicated endpoint in future. |
| Testing & QA | Included in dev time | Thorough testing of all draft modes and edge cases. |
| Security Audits | _[TBD]_ | Ensuring Firestore security rules and wallet integration are robust. |

### Why This Budget Is Necessary

1. **Sustainability.** Asgard Duels has been built as a passion project, but ongoing development requires dedicated time that competes with other income sources.
2. **Server costs grow with success.** As more players use the platform, Firebase costs increase from database reads/writes, Cloud Function executions, and bandwidth.
3. **Community management is essential.** Without active social media and event organization, even the best platform will go unused.
4. **Prize pools drive participation.** Funded prize pools are the single most effective way to attract competitive players and grow the community.

---

## 8. TEAM

### Core Team (2 Members)

#### Lead Developer — [YOUR NAME]
- **Role:** Full-stack developer, project lead, system architect
- **Responsibilities:**
  - All frontend development (React.js, CSS, responsive design)
  - All backend development (Firebase Firestore, Cloud Functions, security rules)
  - Aurory API integration and match verification system
  - AURY token integration (wallet, entry fees, prize distribution)
  - DevOps, deployment, and infrastructure management
  - Product design and feature prioritization
- **Background:** _[Add your relevant experience, years of development experience, previous projects, and connection to the Aurory community]_

#### Community SMM — [PARTNER NAME]
- **Role:** Social Media Manager, Community Engagement Lead
- **Responsibilities:**
  - Managing official social media accounts (Twitter/X, Discord, etc.)
  - Creating and scheduling promotional content
  - Organizing and promoting community tournaments
  - Gathering player feedback and feature requests
  - Coordinating with the broader Aurory/DAOry community
  - Event hosting and live tournament management
- **Background:** _[Add relevant experience with community management, social media, and connection to the Aurory community]_

### Why a Small Team Works

- **Lean and efficient.** A two-person team with clear role separation (development vs. community) minimizes overhead while maximizing output.
- **Community-embedded.** Both team members are active Aurory community members, ensuring the platform reflects real player needs.
- **Proven execution.** The platform is already live and functional — this is not a promise, it's a track record.

---

## 9. MONTHLY DATA TRACKING REPORT TEMPLATE

The following metrics will be tracked and reported to the DAOry on a monthly basis to demonstrate platform growth and community impact.

### 9.1 Community Effectiveness

| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 |
|---|---|---|---|---|---|---|
| Discord members (Asgard Duels) | _[#]_ | | | | | |
| Twitter/X followers | _[#]_ | | | | | |
| New registered users | _[#]_ | | | | | |
| Active users (monthly) | _[#]_ | | | | | |
| Community posts/interactions | _[#]_ | | | | | |

### 9.2 Monthly Visitors

| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 |
|---|---|---|---|---|---|---|
| Unique visitors | _[#]_ | | | | | |
| Page views | _[#]_ | | | | | |
| Average session duration | _[time]_ | | | | | |
| Bounce rate | _[%]_ | | | | | |
| Mobile vs Desktop ratio | _[%]_ | | | | | |

### 9.3 Tournaments Created Monthly

| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 |
|---|---|---|---|---|---|---|
| Total drafts created | _[#]_ | | | | | |
| 3v3 drafts (Mode 1 & 2) | _[#]_ | | | | | |
| 1v1 drafts (Mode 3 & 4) | _[#]_ | | | | | |
| Competitive (entry fee) drafts | _[#]_ | | | | | |
| Friendly (free) drafts | _[#]_ | | | | | |
| Completed drafts | _[#]_ | | | | | |
| Cancelled/abandoned drafts | _[#]_ | | | | | |

### 9.4 Number of Participants Monthly

| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 |
|---|---|---|---|---|---|---|
| Total unique participants | _[#]_ | | | | | |
| Total matches played | _[#]_ | | | | | |
| New participants (first-time) | _[#]_ | | | | | |
| Repeat participants | _[#]_ | | | | | |
| Average participants per draft | _[#]_ | | | | | |
| AURY wagered (total) | _[amount]_ | | | | | |
| AURY distributed (prizes) | _[amount]_ | | | | | |

### 9.5 Platform Health

| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 |
|---|---|---|---|---|---|---|
| Uptime (%) | _[%]_ | | | | | |
| Bug reports filed | _[#]_ | | | | | |
| Bug reports resolved | _[#]_ | | | | | |
| Features released | _[#]_ | | | | | |
| Verified matches (via API) | _[#]_ | | | | | |

---

## 10. APPENDIX — DRAFT MODE REFERENCE

### Mode 1: 3v3 Triad Swiss Draft (Standard)
- **Format:** 3v3 team draft
- **Ban Phase:** Simultaneous blind ban (1 Amiko per team captain)
- **Pick Order:** A picks 3 → B picks 6 → A picks 6 → B picks 3
- **Total Amikos:** 18 per match (9 per team, 3 per player)
- **Unique Picks:** Yes, no mirror selections

### Mode 2: 3v3 Triad Swiss Draft (Alternate)
- **Format:** 3v3 team draft
- **Ban Phase:** Simultaneous blind ban (1 Amiko per team captain)
- **Pick Order:** A-1, B-2, A-2, B-2, A-2, B-2, A-2, B-2, A-2, B-1
- **Total Amikos:** 18 per match
- **Unique Picks:** Yes, strategic blocking encouraged

### Mode 3: 1v1 Random Pool Draft
- **Format:** 1v1 simultaneous draft
- **Pool:** 8 random Amikos per player (private)
- **Picks:** 3 simultaneous selections
- **Verification:** Automatic via Aurory API

### Mode 4: 1v1 Ban Draft
- **Format:** 1v1 turn-based
- **Coin Flip:** Winner chooses 1st Ban or 1st Pick
- **Ban Phase:** 6 total bans (1-2-2-1 rotation), element restriction (no duplicate elements)
- **Pick Phase:** 6 total picks (1-2-2-1 rotation)
- **Mirror Picks:** Allowed (both players can pick the same Amiko)

---

**Asgard Duels** — *Powering competitive Amiko Legends, by the community, for the community.*

---

> **Note to the team:** Please fill in all `[TBD]` fields with actual values before submission. Budget amounts should be denominated in both USD and AURY at the current exchange rate. Add your personal backgrounds in Section 8. Populate initial Month 1 data in Section 9 with your current analytics.
