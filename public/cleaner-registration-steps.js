/*
 * The Cleaner registration wizard, transcribed from the design.
 *
 * The design renders each step from a field table rather than from markup. This carries
 * the same shape: nineteen steps in the design's order and titles, and for each step a
 * list of sections whose fields declare a type and a column span out of twelve.
 *
 * Field types match the design's own factories:
 *   text | date | select | toggle | upload | button
 *
 * `personal` is transcribed field for field. The remaining steps carry their title and
 * description; their field tables are not yet transcribed, and each says so on screen
 * rather than rendering an empty form that looks broken.
 */

export const countries = ["United Kingdom", "Ireland", "Poland", "Romania", "Other"];

export const wizardSteps = [
  {
    key: "personal",
    title: "Personal details",
    description: "Tell us who you are and how to reach you. This is the name clients will see once you go live.",
    sections: [
      {
        title: "Your details",
        fields: [
          { type: "text", label: "First name", span: 3, required: true, prefill: "firstName" },
          { type: "text", label: "Middle name", span: 3 },
          { type: "text", label: "Last name", span: 3, required: true, prefill: "lastName" },
          { type: "text", label: "Preferred name", span: 3 },
          { type: "date", label: "Date of birth", span: 4, required: true },
          { type: "select", label: "Gender (optional)", span: 4, options: ["Prefer not to say", "Female", "Male", "Non-binary"] },
          { type: "select", label: "Nationality", span: 4, required: true, options: ["British", "Irish", "Polish", "Romanian", "Other"] },
          { type: "text", label: "Mobile number", span: 4, required: true, inputType: "tel" },
          { type: "text", label: "Alternative phone", span: 4, inputType: "tel" },
          { type: "text", label: "Email address", span: 4, required: true, inputType: "email", prefill: "email" }
        ]
      },
      {
        title: "Emergency contact",
        fields: [
          { type: "text", label: "Name", span: 4, required: true },
          { type: "text", label: "Number", span: 4, required: true, inputType: "tel" },
          { type: "select", label: "Relationship", span: 4, required: true, options: ["Parent", "Partner", "Sibling", "Friend", "Other"] }
        ]
      },
      {
        title: "Address",
        fields: [
          { type: "text", label: "Postcode", span: 3, required: true, hint: "Used for distances & job matching" },
          { type: "button", label: "Look up address", span: 3, note: "Address lookup is not connected yet." },
          { type: "text", label: "House number", span: 3, required: true },
          { type: "text", label: "Street", span: 3, required: true },
          { type: "text", label: "Town", span: 4, required: true },
          { type: "text", label: "County", span: 4 },
          { type: "select", label: "Country", span: 4, required: true, options: countries }
        ]
      },
      {
        title: "",
        fields: [
          { type: "toggle", label: "Lived here less than 5 years?", span: 12, hint: "If so, we need your previous addresses for background checks." }
        ]
      },
      {
        title: "Profile photo",
        fields: [
          { type: "upload", label: "Profile photo", span: 12, hint: "A clear, friendly headshot — JPEG or PNG" }
        ]
      }
    ]
  },
  { key: "identity", title: "Identity verification", description: "Government-issued photo ID. We verify documents automatically, usually within minutes." },
  { key: "rtw", title: "Right to work", description: "Confirm your right to work in the UK." },
  { key: "dbs", title: "Background checks (DBS)", description: "A basic DBS check, renewed periodically." },
  { key: "business", title: "Business details", description: "How you work — sole trader, limited company or partnership." },
  { key: "tax", title: "Tax & self-employment", description: "Your tax status and National Insurance details." },
  { key: "experience", title: "Cleaning experience", description: "Where you have worked and what you have cleaned." },
  { key: "references", title: "References", description: "People who can vouch for your work." },
  { key: "insurance", title: "Insurance", description: "Public liability cover and its renewal date." },
  { key: "banking", title: "Banking & payments", description: "Where your payouts are sent." },
  { key: "equipment", title: "Equipment", description: "What you bring and what you expect the client to provide." },
  { key: "transport", title: "Transport", description: "How you travel between jobs." },
  { key: "availability", title: "Availability", description: "The hours you can regularly work." },
  { key: "areas", title: "Work areas", description: "Where you are willing to travel for jobs." },
  { key: "languages", title: "Languages", description: "The languages you speak with clients." },
  { key: "skills", title: "Skills", description: "Extra skills that unlock more job types." },
  { key: "training", title: "Training & certificates", description: "Courses and certificates you already hold." },
  { key: "compliance", title: "Compliance & declarations", description: "The agreements you sign before going live." },
  { key: "review", title: "Review & submit", description: "Check everything, then send your registration to Homle." }
];

export function stepByKey(key) {
  return wizardSteps.find((step) => step.key === key) || wizardSteps[0];
}

export function stepNumber(key) {
  const index = wizardSteps.findIndex((step) => step.key === key);
  return (index < 0 ? 0 : index) + 1;
}
