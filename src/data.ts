export type View = "Graph" | "Sequence" | "State";

export type Step = {
  title: string;
  note: string;
  event: string;
  type: string;
  active: string[];
  transfers?: { from: string; to: string; value?: string }[];
};

export type Entity = {
  id: string;
  label: string;
  x: number;
  y: number;
  group: string;
};

/** [step it becomes true, full value, optional short label for the graph] */
export type Change = [at: number, value: string, short?: string];
export type StateRow = { entity: string; path: string; changes: Change[] };
export type SequenceRow = [from: string, to: string, event: string, at: number];

export type Chapter = { id: string; title: string; start: number; end: number; summary?: string };
export type CausalLink = {
  id: string;
  title: string;
  step: number;
  trigger: string;
  observedEvent: string;
  stateChange: string;
  consequence: string;
  evidence: { step: number; event: number }[];
};

export type Scenario = {
  id: string;
  title: string;
  description: string;
  steps: Step[];
  sequenceRows: SequenceRow[];
  stateRows: StateRow[];
  chapters: Chapter[];
  causalLinks: CausalLink[];
};

export const ENTITY_W = 116;
export const ENTITY_H = 52;
export const GRAPH_W = 828;
export const GRAPH_H = 300;

export const groups = [
  { id: "request", name: "REQUEST + ORDER", x: 18, y: 30, w: 372, h: 254 },
  { id: "processing", name: "PROCESSING", x: 420, y: 30, w: 176, h: 254 },
  { id: "external", name: "EXTERNAL", x: 626, y: 30, w: 184, h: 254 },
];

export const entities: Entity[] = [
  { id: "customer", label: "Customer", x: 34, y: 66, group: "request" },
  { id: "api", label: "Checkout API", x: 238, y: 66, group: "request" },
  { id: "order", label: "Order record", x: 238, y: 210, group: "request" },
  { id: "queue", label: "Payment queue", x: 444, y: 66, group: "processing" },
  { id: "worker", label: "Payment worker", x: 444, y: 210, group: "processing" },
  { id: "provider", label: "Provider", x: 650, y: 66, group: "external" },
  { id: "outcome", label: "Known outcome", x: 650, y: 210, group: "external" },
];

export const links: [string, string, number][] = [
  ["customer", "api", 1],
  ["api", "order", 2],
  ["order", "queue", 3],
  ["queue", "worker", 4],
  ["worker", "provider", 5],
  ["provider", "outcome", 7],
];

const baseSteps = (overrides: Partial<Step>[]): Step[] => {
  const steps: Step[] = [
    {
      title: "Initial state",
      note: "All services are idle. No payment evidence has been recorded.",
      event: "trace:init",
      type: "snapshot",
      active: ["customer"],
    },
    {
      title: "Checkout submitted",
      note: "The request is sent, but receipt has not yet been observed.",
      event: "requestSent",
      type: "message:sent",
      active: ["customer", "api"],
      transfers: [{ from: "Customer", to: "Checkout API", value: "POST /checkout" }],
    },
    {
      title: "Order persisted",
      note: "An explicit write records the order as awaiting payment.",
      event: "orderPending",
      type: "write",
      active: ["api", "order"],
      transfers: [{ from: "Checkout API", to: "Order record", value: "ord-1042" }],
    },
    {
      title: "Payment job queued",
      note: "A local queue entry is created with idempotency key pay-ord-1042.",
      event: "jobQueued",
      type: "write",
      active: ["order", "queue"],
      transfers: [{ from: "Order record", to: "Payment queue", value: "pay-ord-1042" }],
    },
    {
      title: "Worker receives job",
      note: "Delivery is explicitly recorded. The worker begins the first attempt.",
      event: "jobFirstReceived",
      type: "message:received",
      active: ["queue", "worker"],
      transfers: [{ from: "Payment queue", to: "Payment worker", value: "attempt 1" }],
    },
    {
      title: "Charge requested",
      note: "The provider receives the charge. A response is not yet modeled.",
      event: "chargeFirstSent",
      type: "message:sent",
      active: ["worker", "provider"],
      transfers: [{ from: "Payment worker", to: "Provider", value: "charge(4200)" }],
    },
    {
      title: "Provider processes charge",
      note: "The simulated provider records one charge. Worker outcome remains unknown.",
      event: "providerCharged",
      type: "write · simulated",
      active: ["provider"],
    },
    {
      title: "Worker times out",
      note: "Timeout does not prove decline or loss. The payment outcome stays unknown.",
      event: "workerTimeout",
      type: "write",
      active: ["worker", "outcome"],
    },
  ];
  return steps.map((step, i) => ({ ...step, ...overrides[i] }));
};

export const scenarios: Scenario[] = [
  {
    id: "timeout",
    title: "Checkout recovery",
    description: "The worker times out after the provider has already charged.",
    steps: baseSteps([]),
    sequenceRows: [
      ["Checkout API", "Payment worker", "enqueue(pay-ord-1042)", 3],
      ["Payment queue", "Payment worker", "jobFirst · received", 4],
      ["Payment worker", "Provider", "paymentFirst · sent", 5],
      ["Provider", "Provider state", "providerCharged · write", 6],
      ["Payment worker", "Known outcome", "workerTimeout · write", 7],
    ],
    stateRows: [
      { entity: "customer", path: "checkoutStatus", changes: [[0, "idle"], [1, "submitted"]] },
      { entity: "api", path: "status", changes: [[1, "accepted"]] },
      { entity: "order", path: "status", changes: [[2, "awaiting_payment"]] },
      { entity: "queue", path: "jobs", changes: [[3, "[ pay-ord-1042 ]", "1 pending"]] },
      {
        entity: "worker",
        path: "stage",
        changes: [[4, "attempt_1"], [7, "timed_out"]],
      },
      { entity: "provider", path: "count", changes: [[6, "1", "1 charge"]] },
      { entity: "outcome", path: "status", changes: [[7, "unknown"]] },
    ],
    chapters: [
      { id: "submit", title: "Submission", start: 0, end: 2, summary: "The customer request becomes a durable order." },
      { id: "processing", title: "Payment processing", start: 3, end: 6, summary: "A queued job reaches the provider, which charges once." },
      { id: "uncertain", title: "Uncertain outcome", start: 7, end: 7, summary: "The worker gives up without knowing what the provider did." },
    ],
    causalLinks: [
      {
        id: "timeout-unknown",
        title: "Timeout leaves the outcome unknown",
        step: 7,
        trigger: "The worker's wait for a provider response elapses.",
        observedEvent: "workerTimeout is written by the worker.",
        stateChange: "worker.stage becomes timed_out; outcome.status stays unknown.",
        consequence: "A retry must reuse pay-ord-1042 to avoid charging twice.",
        evidence: [
          { step: 6, event: 0 },
          { step: 7, event: 0 },
        ],
      },
    ],
  },
  {
    id: "acknowledged",
    title: "Acknowledged charge",
    description: "The provider answers in time and the order is marked paid.",
    steps: baseSteps([
      {},
      {},
      {},
      {},
      {},
      {},
      {
        title: "Provider confirms charge",
        note: "The provider records one charge and returns a receipt to the worker.",
        event: "providerConfirmed",
        type: "message:received",
        active: ["provider", "worker"],
        transfers: [{ from: "Provider", to: "Payment worker", value: "receipt rc-77" }],
      },
      {
        title: "Order marked paid",
        note: "The worker writes the receipt; the payment outcome is now known.",
        event: "orderPaid",
        type: "write",
        active: ["worker", "outcome", "order"],
        transfers: [{ from: "Payment worker", to: "Known outcome", value: "paid" }],
      },
    ]),
    sequenceRows: [
      ["Checkout API", "Payment worker", "enqueue(pay-ord-1042)", 3],
      ["Payment queue", "Payment worker", "jobFirst · received", 4],
      ["Payment worker", "Provider", "paymentFirst · sent", 5],
      ["Provider", "Payment worker", "receipt · received", 6],
      ["Payment worker", "Known outcome", "orderPaid · write", 7],
    ],
    stateRows: [
      { entity: "customer", path: "checkoutStatus", changes: [[0, "idle"], [1, "submitted"]] },
      { entity: "api", path: "status", changes: [[1, "accepted"]] },
      { entity: "order", path: "status", changes: [[2, "awaiting_payment"], [7, "paid"]] },
      {
        entity: "queue",
        path: "jobs",
        changes: [[3, "[ pay-ord-1042 ]", "1 pending"], [7, "[ ]", "drained"]],
      },
      { entity: "worker", path: "stage", changes: [[4, "attempt_1"], [6, "charged"]] },
      { entity: "provider", path: "count", changes: [[5, "1", "1 charge"]] },
      { entity: "outcome", path: "status", changes: [[7, "paid", "paid"]] },
    ],
    chapters: [
      { id: "submit", title: "Submission", start: 0, end: 2 },
      { id: "processing", title: "Payment processing", start: 3, end: 5 },
      { id: "settled", title: "Settlement", start: 6, end: 7, summary: "A receipt turns the uncertain charge into a known outcome." },
    ],
    causalLinks: [
      {
        id: "receipt-paid",
        title: "Receipt makes the outcome known",
        step: 7,
        trigger: "The provider's receipt arrives before the timeout.",
        observedEvent: "orderPaid is written by the worker.",
        stateChange: "order.status becomes paid; outcome.status becomes paid.",
        consequence: "The queue entry can be drained; no retry is needed.",
        evidence: [
          { step: 6, event: 0 },
          { step: 7, event: 0 },
        ],
      },
    ],
  },
];

export function valueAt(row: StateRow | undefined, step: number) {
  let hit: Change | undefined;
  for (const change of row?.changes ?? []) if (change[0] <= step) hit = change;
  return hit;
}
