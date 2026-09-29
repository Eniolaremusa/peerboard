export type Fact = {
  id: string;
  fact: string;
  unlockedBy: string;
  critical?: boolean;
};

export type Prompt = {
  id: string;
  title: string;
  brief: string;
  context: string;
  facts: Fact[];
  curveball: string;
  curveballAtMinute: number;
};

export const prompts: Prompt[] = [
  {
    id: "returns",
    title: "Online returns",

    // The one line the candidate sees.
    brief:
      "We're a clothing retailer and our returns process isn't working. Design a better one.",

    // Never shown to the candidate. Given to the model as the source of truth.
    context:
      "Mid-size online clothing retailer, UK and Ireland. The team framed this as a returns problem, but the real cost is the support load returns create. A good candidate should get to that. The stakeholder answering questions is the Head of Customer Operations: helpful, but only answers what is asked.",

    facts: [
      {
        id: "volume",
        fact: "About 400,000 orders a month, with a 12 percent return rate.",
        unlockedBy: "How many returns are we handling? What's the scale?",
      },
      {
        id: "why-returns",
        fact: "Around 60 percent of returns are size related. The item didn't fit.",
        unlockedBy: "Why are people returning things?",
      },
      {
        id: "real-problem",
        fact: "The goal isn't to reduce returns. Returns are expected in clothing. The goal is to reduce the support tickets they generate.",
        unlockedBy:
          "What does success look like? Are we trying to reduce returns?",
        critical: true,
      },
      {
        id: "support-load",
        fact: "Roughly 70 percent of return-related tickets come from customers who already started a return in the app and got stuck or confused.",
        unlockedBy:
          "What are people contacting support about? Where does the support load come from?",
        critical: true,
      },
      {
        id: "already-tried",
        fact: "A self-serve returns portal launched 14 months ago. Only 22 percent of customers use it. The rest still email or call.",
        unlockedBy: "What have you already tried? Is there anything in place today?",
      },
      {
        id: "logistics",
        fact: "There's no in-house logistics. A third-party courier handles pickups, and their pickup windows are 48 hours and can't be controlled or narrowed.",
        unlockedBy:
          "How does the item physically get back to you? Who handles shipping?",
        critical: true,
      },
      {
        id: "refund-window",
        fact: "Refunds must legally be issued within 14 days of the item arriving back. Slow refunds are the single most common complaint.",
        unlockedBy: "How do refunds work? What happens after the item comes back?",
      },
      {
        id: "users",
        fact: "The customer base skews 45 and older and is not especially tech-forward. Many still prefer phone contact.",
        unlockedBy: "Who are our customers? Tell me about the users.",
      },
      {
        id: "team",
        fact: "The support team is 30 people. It's the biggest line item in customer operations.",
        unlockedBy: "How big is the support team? What does this cost you?",
      },
      {
        id: "app-vs-web",
        fact: "About 65 percent of orders come through the mobile app, but only 30 percent of returns are started there.",
        unlockedBy:
          "Where do people shop, app or web? Where do returns get started?",
      },
    ],

    curveball:
      "Our courier partner is dropping their home pickup service in three months. Everything has to go through drop-off points from then on.",
    curveballAtMinute: 22,
  },
  {
    id: "onboarding",
    title: "Onboarding drop-off",

    brief:
      "We're a project management tool for small teams. Most people who sign up never finish setting up. Redesign the onboarding.",

    context:
      "B2B SaaS, self-serve, around £29 per seat per month. The team has framed this as an onboarding design problem. It isn't. The drop-off is concentrated in accounts that were never a good fit, because marketing shifted its spend to a cheaper audience last year. A strong candidate should notice the drop-off is not evenly spread and ask why. The stakeholder is the Head of Growth: open, a bit defensive about the marketing point, but honest when asked directly.",

    facts: [
      {
        id: "dropoff-rate",
        fact: "About 8,000 signups a month. Roughly 70 percent never complete setup.",
        unlockedBy: "How many people sign up, and how many drop off?",
      },
      {
        id: "not-even",
        fact: "The drop-off isn't evenly spread. Signups from paid search drop off at nearly 90 percent. Referrals and word of mouth complete at over 60 percent.",
        unlockedBy:
          "Is the drop-off the same across all users, or does it vary by segment or channel?",
        critical: true,
      },
      {
        id: "marketing-shift",
        fact: "Marketing moved most of the budget to cheaper paid search keywords 11 months ago. Signup volume tripled, paid conversion barely moved.",
        unlockedBy:
          "Has anything changed recently? Why did signups go up? Where do paid signups come from?",
        critical: true,
      },
      {
        id: "wrong-fit",
        fact: "Most paid search signups are individuals looking for a free personal to-do list. The product is built for teams of 5 to 50.",
        unlockedBy:
          "Who are the people signing up through paid search? What are they trying to do?",
        critical: true,
      },
      {
        id: "where-they-stop",
        fact: "The most common exit point is the step that asks you to invite teammates. Around 55 percent of drop-offs happen there.",
        unlockedBy: "Where in the flow do people stop?",
      },
      {
        id: "setup-length",
        fact: "Setup is 6 steps and takes around 9 minutes if you do it properly, including creating a first project.",
        unlockedBy: "What does the current onboarding actually involve?",
      },
      {
        id: "already-tried",
        fact: "The team already shortened onboarding from 9 steps to 6 last quarter. Completion improved by 2 percent.",
        unlockedBy: "What have you already tried?",
      },
      {
        id: "retention",
        fact: "Teams that do finish setup retain well. About 80 percent are still active after 6 months.",
        unlockedBy:
          "What happens to the people who do complete? Do they stick around?",
      },
      {
        id: "sales-pressure",
        fact: "The growth team is measured on signup volume, not activated teams. Nobody wants to reduce signups.",
        unlockedBy:
          "What is the team measured on? What does success look like for you?",
      },
      {
        id: "no-mobile",
        fact: "There's no mobile app. Onboarding on a phone is possible but poor, and about a third of paid search signups arrive on mobile.",
        unlockedBy: "What devices are people signing up on? Is there a mobile app?",
      },
    ],

    curveball:
      "Leadership has just told us signup volume is a board-level metric this year. Whatever you design, we can't do anything that reduces the number of signups.",
    curveballAtMinute: 22,
  },

  {
    id: "field-inspections",
    title: "Field inspections",

    brief:
      "We build software for building safety inspectors. They hate our mobile app and most of them still use paper. Design something they'll actually use.",

    context:
      "The company sells to local councils. Inspectors check fire safety, structural issues and accessibility in commercial buildings. The obvious answer is a better mobile form, but connectivity and glove use make a typing-heavy interface unworkable, and the legal sign-off requirement rules out anything that auto-submits. The stakeholder is a Product Manager who used to be an inspector: practical, quick to say when an idea won't survive contact with the job.",

    facts: [
      {
        id: "no-signal",
        fact: "Inspections happen in basements, plant rooms and stairwells. There's usually no signal at all, sometimes for the whole visit.",
        unlockedBy:
          "What's the environment like? Do they have internet while inspecting?",
        critical: true,
      },
      {
        id: "gloves",
        fact: "Inspectors wear thick gloves and carry a torch and a clipboard. They're often on a ladder or in a crawl space. One hand is usually occupied.",
        unlockedBy:
          "What are they physically doing during an inspection? What are they holding?",
        critical: true,
      },
      {
        id: "legal-signoff",
        fact: "A report is a legal document. It can't be filed until the inspector reviews the whole thing and signs it, and they're liable for what's in it.",
        unlockedBy:
          "What happens to the report after the inspection? Is there any approval step?",
        critical: true,
      },
      {
        id: "paper-workflow",
        fact: "Most inspectors write on paper on site, then retype everything into the app that evening or the next morning.",
        unlockedBy: "What do they do today? How does paper actually work for them?",
      },
      {
        id: "double-entry",
        fact: "That retyping takes 40 to 60 minutes per inspection. Inspectors do 4 to 6 inspections a day.",
        unlockedBy: "How long does the current process take them?",
      },
      {
        id: "photos",
        fact: "Photos are the one part of the app everyone uses. Inspectors take 30 to 80 photos per building and they're the most important evidence.",
        unlockedBy: "Is there any part of the app they do like or use?",
      },
      {
        id: "form-length",
        fact: "The inspection form has around 140 fields, most of them required by regulation. It can't be shortened.",
        unlockedBy: "What's in the inspection form? Can we cut any of it?",
      },
      {
        id: "age",
        fact: "The average inspector is in their fifties and has done the job for over a decade. Several have said they'll retire before they change how they work.",
        unlockedBy: "Who are the inspectors? What's their background?",
      },
      {
        id: "devices",
        fact: "Councils issue rugged Android tablets, usually two or three years old. No iPhones, no personal devices allowed.",
        unlockedBy: "What devices are they using?",
      },
      {
        id: "buyer",
        fact: "The buyer is the council's compliance manager, who mostly cares about audit trails and report turnaround, not inspector experience.",
        unlockedBy: "Who buys this? What do they care about?",
      },
    ],

    curveball:
      "The councils have just told us reports have to be filed within 24 hours of the inspection, not the current five working days.",
    curveballAtMinute: 22,
  },
];

export function getPrompt(id: string | undefined | null) {
  if (!id) {
    return undefined;
  }
  return prompts.find((item) => item.id === id);
}