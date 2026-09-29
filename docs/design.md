# PRD: Peer Interview Practice for Designers

*Working title. Draft 2.*

## What it is

A practice product where designers run mock interviews with each other. Two people book one session, take turns as interviewer and candidate, and both get a report afterwards. AI holds the hidden brief, coaches the interviewer, and grades the session after it ends.

The headline feature is peer whiteboarding. Solo AI sessions exist so the product works with one user and so nobody is stranded when a peer no-shows.

## Why it exists

- Designers get almost no feedback from real interviews. They fail and never learn why.
- Whiteboard rounds are the least practiced and hardest to rehearse alone.
- AI-only interview tools already exist and are crowded. Peer-to-peer for designers does not.

## Existing landscape

- **UXMock** does AI whiteboard simulation for designers.
- **Mockin** does AI behavioural interviews, portfolio and CV reviews.
- **Exponent** runs the peer model well, but its session types are PM, behavioural, coding, system design and finance. No design whiteboarding.

The gap is peer matching plus AI as a silent observer, for design rounds.

## Users

Product and UX designers preparing for interviews, roughly 2 to 8 years in. Desktop only.

## Core mechanics

### The hidden brief

Every prompt has a background document the candidate cannot see. Users, business constraint, what has been tried, platform limits. Facts are released only when the candidate asks a question that reaches them.

In solo mode the AI holds it. In peer mode the interviewer holds it as fact cards.

Scoring includes how many facts were surfaced, and which important ones were missed.

### The curveball

One scripted constraint dropped partway through the session. "Engineering says push notifications are off the table." How someone adapts is the highest signal moment in the round.

In peer mode it arrives as a card on the interviewer's screen at a set point in the session. In solo mode the AI delivers it directly.

### AI is silent during the session

The AI never speaks to the candidate mid-round. That would break the point of practising. It feeds cards to the interviewer and produces the report afterwards.

## Session types

| Type | Solo | Peer |
|---|---|---|
| Whiteboard | Yes | Yes, the headline |
| Behavioural | Yes | Later |
| Portfolio presentation | Later | Later |

Behavioural solo shares the engine with portfolio presentation: voice in, voice out, one real follow-up per answer, one grading pass. Adding portfolio later is cheap.

## Session flow

1. Book a slot. One booking covers both rounds, so reciprocity is automatic.
2. Confirm attendance a couple of hours before.
3. Join the room. Roles assigned, candidate goes first.
4. Round one runs 40 minutes.
5. Swap roles, round two.
6. Both people get a report combining AI grading and their peer's scorecard.

If a peer does not show, the room converts to a solo AI session with the same prompt.

## Screens

### Candidate

- Video at full width
- Two square cards at the bottom, side by side, not spanning the full width:
  - **Whiteboard**, opens the canvas
  - **Notes**, a private scratchpad visible only to them
- Thin overlay showing session countdown and the prompt collapsed to one line, expandable

The whiteboard opens automatically when the session starts, with video shrunk to small tiles. The Whiteboard card then acts as a toggle back to full video. The board should never start hidden, or people forget it is there.

The canvas is embedded, so there is no screen sharing at any point.

Keep it to those two cards. Every extra control is somewhere to look instead of think.

### Interviewer

- Canvas or video at roughly 70 percent, with cursor presence so they can point at the board, but not full edit rights
- Right rail at 30 percent, two tabs:
  - **Prompt**, the full background and the fact list, marked as revealed or not. Default tab.
  - **Evaluation**, the scorecard they fill in while listening.
- Cards pop over the rail regardless of which tab is open, and are dismissible:
  - Suggested questions for this point in the session
  - Fact cards when relevant
  - The curveball card at its moment

Tabs hold reference material they go looking for. Cards deliver things they need right now. Nothing important should require a tab switch.

The rail suggests. It never scripts. If they are reading it aloud, the session stops feeling like an interview.

## Matching

- Users set recurring availability blocks. No external calendar links, since that costs us no-show tracking and reciprocity enforcement.
- Fixed session times rather than open scheduling. A thin pool needs concentrating, not spreading.
- Swipe or browse on **sessions**, not people. A card shows time, prompt area and experience level. Never a name or photo, which invites bias and looks empty on day one.
- Level matching so a career switcher is not paired with a lead.
- No-show rate tracked per user.

## Report

Inputs: transcript with timestamps, facts revealed and missed, response to the curveball, how long they spent on the board versus talking, canvas snapshots as weak evidence, peer scorecard.

Output points at moments, not qualities. Not "be more concise" but "at 4:12 you spent 90 seconds on background before naming the problem."

Includes one rewritten moment using the candidate's own material.

The peer's scores and the AI's scores are shown separately, never merged.

## Deliberately out of scope for v1

- Mobile. Drawing plus video plus a side rail does not fit on a phone. Say so at signup.
- Hiring managers and paid expert interviewers. That is an ADPList competitor with a supply problem, and a different business.
- Grading the drawing itself. Models are unreliable on rough wireframes. Snapshots answer one narrow question: does the canvas match what they said they were doing.
- Screen sharing and live screen reading. The canvas is embedded, so there is nothing to read.

## Stack

- Next.js on Vercel
- Excalidraw, embedded, MIT licensed with no key or watermark. Chosen over tldraw, which now needs a paid licence key in production.
- LiveKit or Daily for video, with per-participant audio tracks so speaker attribution is free
- excalidraw-room on a small VPS for canvas sync, only needed for peer mode
- Postgres via Supabase or Neon
- Deepgram or AssemblyAI for transcription
- Claude API for the hidden brief responses and the post-session report
- S3 or R2 for snapshots and recordings
- Resend for reminders

## Known constraints

- Two runtimes. The sync server is stateful and cannot live on Vercel.
- Latency from Lagos to North America through a relayed media server. Test with a real person early.
- Cost per peer session stacks: video minutes for two, 90 minutes of transcription, a long grading call. Work out the real number before designing a free tier.
- Recording consent from both people, a stated retention window, a working delete path.
- Store all times in UTC. Lagos, Toronto and Vancouver plus daylight saving will produce bugs otherwise.
- Decide what happens when a connection drops mid-round. Annoying to retrofit.

## What tells us it works

- Someone finishes a solo session and immediately starts another
- People turn up to booked peer sessions
- A report says something the user could not have told themselves# PRD: Peer Interview Practice for Designers

*Working title. Draft 2.*

## What it is

A practice product where designers run mock interviews with each other. Two people book one session, take turns as interviewer and candidate, and both get a report afterwards. AI holds the hidden brief, coaches the interviewer, and grades the session after it ends.

The headline feature is peer whiteboarding. Solo AI sessions exist so the product works with one user and so nobody is stranded when a peer no-shows.

## Why it exists

- Designers get almost no feedback from real interviews. They fail and never learn why.
- Whiteboard rounds are the least practiced and hardest to rehearse alone.
- AI-only interview tools already exist and are crowded. Peer-to-peer for designers does not.

## Existing landscape

- **UXMock** does AI whiteboard simulation for designers.
- **Mockin** does AI behavioural interviews, portfolio and CV reviews.
- **Exponent** runs the peer model well, but its session types are PM, behavioural, coding, system design and finance. No design whiteboarding.

The gap is peer matching plus AI as a silent observer, for design rounds.

## Users

Product and UX designers preparing for interviews, roughly 2 to 8 years in. Desktop only.

## Core mechanics

### The hidden brief

Every prompt has a background document the candidate cannot see. Users, business constraint, what has been tried, platform limits. Facts are released only when the candidate asks a question that reaches them.

In solo mode the AI holds it. In peer mode the interviewer holds it as fact cards.

Scoring includes how many facts were surfaced, and which important ones were missed.

### The curveball

One scripted constraint dropped partway through the session. "Engineering says push notifications are off the table." How someone adapts is the highest signal moment in the round.

In peer mode it arrives as a card on the interviewer's screen at a set point in the session. In solo mode the AI delivers it directly.

### AI is silent during the session

The AI never speaks to the candidate mid-round. That would break the point of practising. It feeds cards to the interviewer and produces the report afterwards.

## Session types

| Type | Solo | Peer |
|---|---|---|
| Whiteboard | Yes | Yes, the headline |
| Behavioural | Yes | Later |
| Portfolio presentation | Later | Later |

Behavioural solo shares the engine with portfolio presentation: voice in, voice out, one real follow-up per answer, one grading pass. Adding portfolio later is cheap.

## Session flow

1. Book a slot. One booking covers both rounds, so reciprocity is automatic.
2. Confirm attendance a couple of hours before.
3. Join the room. Roles assigned, candidate goes first.
4. Round one runs 40 minutes.
5. Swap roles, round two.
6. Both people get a report combining AI grading and their peer's scorecard.

If a peer does not show, the room converts to a solo AI session with the same prompt.

## Screens

### Candidate

- Video at full width
- Two square cards at the bottom, side by side, not spanning the full width:
  - **Whiteboard**, opens the canvas
  - **Notes**, a private scratchpad visible only to them
- Thin overlay showing session countdown and the prompt collapsed to one line, expandable

The whiteboard opens automatically when the session starts, with video shrunk to small tiles. The Whiteboard card then acts as a toggle back to full video. The board should never start hidden, or people forget it is there.

The canvas is embedded, so there is no screen sharing at any point.

Keep it to those two cards. Every extra control is somewhere to look instead of think.

### Interviewer

- Canvas or video at roughly 70 percent, with cursor presence so they can point at the board, but not full edit rights
- Right rail at 30 percent, two tabs:
  - **Prompt**, the full background and the fact list, marked as revealed or not. Default tab.
  - **Evaluation**, the scorecard they fill in while listening.
- Cards pop over the rail regardless of which tab is open, and are dismissible:
  - Suggested questions for this point in the session
  - Fact cards when relevant
  - The curveball card at its moment

Tabs hold reference material they go looking for. Cards deliver things they need right now. Nothing important should require a tab switch.

The rail suggests. It never scripts. If they are reading it aloud, the session stops feeling like an interview.

## Matching

- Users set recurring availability blocks. No external calendar links, since that costs us no-show tracking and reciprocity enforcement.
- Fixed session times rather than open scheduling. A thin pool needs concentrating, not spreading.
- Swipe or browse on **sessions**, not people. A card shows time, prompt area and experience level. Never a name or photo, which invites bias and looks empty on day one.
- Level matching so a career switcher is not paired with a lead.
- No-show rate tracked per user.

## Report

Inputs: transcript with timestamps, facts revealed and missed, response to the curveball, how long they spent on the board versus talking, canvas snapshots as weak evidence, peer scorecard.

Output points at moments, not qualities. Not "be more concise" but "at 4:12 you spent 90 seconds on background before naming the problem."

Includes one rewritten moment using the candidate's own material.

The peer's scores and the AI's scores are shown separately, never merged.

## Deliberately out of scope for v1

- Mobile. Drawing plus video plus a side rail does not fit on a phone. Say so at signup.
- Hiring managers and paid expert interviewers. That is an ADPList competitor with a supply problem, and a different business.
- Grading the drawing itself. Models are unreliable on rough wireframes. Snapshots answer one narrow question: does the canvas match what they said they were doing.
- Screen sharing and live screen reading. The canvas is embedded, so there is nothing to read.

## Stack

- Next.js on Vercel
- Excalidraw, embedded, MIT licensed with no key or watermark. Chosen over tldraw, which now needs a paid licence key in production.
- LiveKit or Daily for video, with per-participant audio tracks so speaker attribution is free
- excalidraw-room on a small VPS for canvas sync, only needed for peer mode
- Postgres via Supabase or Neon
- Deepgram or AssemblyAI for transcription
- Claude API for the hidden brief responses and the post-session report
- S3 or R2 for snapshots and recordings
- Resend for reminders

## Known constraints

- Two runtimes. The sync server is stateful and cannot live on Vercel.
- Latency from Lagos to North America through a relayed media server. Test with a real person early.
- Cost per peer session stacks: video minutes for two, 90 minutes of transcription, a long grading call. Work out the real number before designing a free tier.
- Recording consent from both people, a stated retention window, a working delete path.
- Store all times in UTC. Lagos, Toronto and Vancouver plus daylight saving will produce bugs otherwise.
- Decide what happens when a connection drops mid-round. Annoying to retrofit.

## What tells us it works

- Someone finishes a solo session and immediately starts another
- People turn up to booked peer sessions
- A report says something the user could not have told themselves

Speech-to-text: The interview session should generate a near-real-time transcript that can be used by the AI interviewer copilot and a complete transcript for post-session evaluation. The initial implementation may use a third-party speech-to-text API. The transcription layer should be abstracted so the provider can be changed later.
Transcription: Use Groq Whisper for the initial implementation unless otherwise specified. Keep transcription behind a service abstraction so the provider can be replaced without changing the interview-room UI or AI evaluation logic.

                    ┌→ Live transcript → AI Copilot
Interview audio ────┤
                    └→ Stored transcript → Post-session AI