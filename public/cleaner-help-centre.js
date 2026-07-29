import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-11";

const helpArticles = [
  {
    question: "What documents do I need to get approved?",
    answer: "Your account may ask for identity, right-to-work, background-check and insurance evidence. Open Documents and each registration step to see the current requirement and status. Items marked optional are not required."
  },
  {
    question: "How long does approval take?",
    answer: "There is no fixed approval time. Your registration and document status are the source of truth, and Homle will show when a submitted item needs attention or has been reviewed."
  },
  {
    question: "Do I need to be registered self-employed?",
    answer: "Homle cannot decide your employment or tax status. Record the way you actually work in Business Details and get guidance from HMRC or a qualified adviser if you are unsure."
  },
  {
    question: "Can I change my work areas later?",
    answer: "You can review your service areas from Work Areas. A change only becomes part of your account after it has been successfully saved and confirmed."
  },
  {
    question: "When do I get paid?",
    answer: "Payment timing depends on the completed booking and the payout setup connected to your account. Check Earnings, Banking and the booking record for the current status rather than relying on a fixed date."
  },
  {
    question: "How does the referral bonus work?",
    answer: "No referral bonus is configured on this preview. Only rely on an offer that appears inside your own Homle account with its eligibility and payment terms."
  },
  {
    question: "What happens if my insurance expires?",
    answer: "Expired insurance may affect whether you can receive or complete bookings that require current cover. Replace the document in Insurance or Documents and wait for the account status to confirm the renewal."
  },
  {
    question: "How do Homle Academy badges work?",
    answer: "The Academy catalogue is currently a preview. A course or badge is not recorded unless your account explicitly shows it as completed or earned."
  },
  {
    question: "Can clients see my address or phone number?",
    answer: "Your public profile does not show your account email, phone number or exact home address. Use Homle Messages for booking communication and share only the access information needed for a confirmed job."
  },
  {
    question: "What if I need to decline a job I already accepted?",
    answer: "Message the booking participant as soon as possible and use the booking's available support or issue controls. An accepted commitment is not silently removed from this Help Centre."
  }
];

const list = document.querySelector("[data-help-faq-list]");
const empty = document.querySelector("[data-help-empty]");
const search = document.querySelector("[data-help-search]");

function renderArticle(article) {
  const details = element("details", "hc-help-article");
  const summary = element("summary", "", article.question);
  const answer = element("p", "", article.answer);
  details.append(summary, answer);
  return details;
}

function renderArticles(query = "") {
  const normalized = String(query).trim().toLocaleLowerCase("en-GB");
  const matches = normalized
    ? helpArticles.filter((article) => `${article.question} ${article.answer}`.toLocaleLowerCase("en-GB").includes(normalized))
    : helpArticles;
  list.replaceChildren(...matches.map(renderArticle));
  empty.hidden = matches.length !== 0;
}

createCleanerPage("help-centre", ({ showFeedback }) => {
  renderArticles();
  search.addEventListener("input", () => renderArticles(search.value));
  for (const button of document.querySelectorAll("[data-help-support-action]")) {
    button.addEventListener("click", () => {
      showFeedback("Support requests are not connected yet. Nothing was submitted.", "error");
      document.querySelector("[data-help-centre-feedback]")?.focus();
    });
  }
});
