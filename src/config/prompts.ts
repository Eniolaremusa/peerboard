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
];
