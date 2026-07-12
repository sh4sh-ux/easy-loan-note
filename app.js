"use strict";

const STORAGE_KEY = "easy-loan-note:draft:v3";
const COMPLETED_STORAGE_KEY = "easy-loan-note:completed:v3";
const MAX_LEGAL_RATE = 20;

const steps = ["당사자", "금액", "상환", "확인", "서명", "완료"];

const state = {
  currentStep: 0,
  data: {},
  signatures: {
    creditor: { dataUrl: "", signedAt: "" },
    debtor: { dataUrl: "", signedAt: "" },
    guarantor: { dataUrl: "", signedAt: "" },
  },
  completed: {
    contractNumber: "",
    completedAt: "",
    documentHash: "",
  },
};

const elements = {};
const signaturePads = new Map();
let deferredInstallPrompt = null;
let saveTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  setDefaultDates();
  renderStepList();
  bindEvents();
  restoreDraft();
  initializeSignatures();
  registerServiceWorker();
  updateAll();
});

function cacheElements() {
  elements.intro = document.querySelector(".intro");
  elements.workspace = document.querySelector(".workspace");
  elements.form = document.querySelector("#loanForm");
  elements.stepPanels = Array.from(document.querySelectorAll(".step-panel"));
  elements.stepList = document.querySelector("#stepList");
  elements.progressFill = document.querySelector("#progressFill");
  elements.formError = document.querySelector("#formError");
  elements.amountPreview = document.querySelector("#amountPreview");
  elements.amountKorean = document.querySelector("#amountKorean");
  elements.reviewDocument = document.querySelector("#reviewDocument");
  elements.printDocument = document.querySelector("#printDocument");
  elements.schedulePreview = document.querySelector("#schedulePreview");
  elements.installButton = document.querySelector("#installButton");
  elements.contractNumberText = document.querySelector("#contractNumberText");
  elements.documentHashText = document.querySelector("#documentHashText");
  elements.creditorSignTime = document.querySelector("#creditorSignTime");
  elements.debtorSignTime = document.querySelector("#debtorSignTime");
  elements.guarantorSignTime = document.querySelector("#guarantorSignTime");
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  elements.form.addEventListener("input", handleFormInput);
  elements.form.addEventListener("change", handleFormInput);
  elements.form.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "date" && typeof target.showPicker === "function") {
      try {
        target.showPicker();
      } catch {
        // 브라우저가 거부하면 기본 동작(포커스)으로 둡니다.
      }
    }
  });
  window.addEventListener("beforeprint", updateDocuments);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
}

function handleDocumentClick(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const action = button.dataset.action;
  const clearSignature = button.dataset.clearSignature;

  if (clearSignature) {
    signaturePads.get(clearSignature)?.clear();
    state.signatures[clearSignature] = { dataUrl: "", signedAt: "" };
    updateSignatureTimes();
    scheduleSave();
    return;
  }

  if (!action) return;

  switch (action) {
    case "start":
      showWorkspace();
      break;
    case "restore":
      showWorkspace();
      break;
    case "prev":
      goToStep(Math.max(0, state.currentStep - 1));
      break;
    case "next":
      if (validateCurrentStep()) goToStep(Math.min(steps.length - 1, state.currentStep + 1));
      break;
    case "complete":
      completeContract();
      break;
    case "print":
      updateDocuments();
      window.print();
      break;
    case "download-html":
      downloadFinalHtml();
      break;
    case "download-json":
      downloadJsonBackup();
      break;
    case "reset":
      resetApp();
      break;
    default:
      break;
  }
}

function handleFormInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.name === "principal") {
    target.value = formatAmountInput(target.value);
  }

  if (target.name === "creditorPhone" || target.name === "debtorPhone" || target.name === "guarantorPhone") {
    target.value = formatPhone(target.value);
  }

  if (target.name === "creditorRRN" || target.name === "debtorRRN" || target.name === "guarantorRRN") {
    target.value = formatRRN(target.value);
  }

  if (target.name === "repaymentAccount") {
    target.value = target.value.replace(/[^\d-]/g, "");
  }

  elements.formError.textContent = "";
  readFormIntoState();
  updateAll();
  scheduleSave();
}

function showWorkspace() {
  elements.intro.hidden = true;
  elements.workspace.hidden = false;
  goToStep(state.currentStep);
}

function setDefaultDates() {
  const today = new Date();
  const loanDate = formatDateInput(today);
  const finalDueDate = formatDateInput(addMonths(today, 12));
  const firstInstallmentDate = formatDateInput(addMonths(today, 1));

  elements.form.elements.loanDate.value ||= loanDate;
  elements.form.elements.finalDueDate.value ||= finalDueDate;
  elements.form.elements.firstInstallmentDate.value ||= firstInstallmentDate;
  elements.form.elements.installmentCount.value ||= "12";
  elements.form.elements.lateRate.value ||= "20";
}

function renderStepList() {
  elements.stepList.innerHTML = steps
    .map((label, index) => `<li data-step-index="${index}">${index + 1}. ${escapeHtml(label)}</li>`)
    .join("");
}

function goToStep(stepIndex) {
  state.currentStep = stepIndex;
  elements.stepPanels.forEach((panel, index) => {
    panel.hidden = index !== stepIndex;
  });

  Array.from(elements.stepList.children).forEach((item, index) => {
    if (index === stepIndex) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });

  elements.progressFill.style.width = `${(stepIndex / (steps.length - 1)) * 100}%`;
  const prevButton = elements.form.querySelector('[data-action="prev"]');
  const nextButton = elements.form.querySelector('[data-action="next"]');
  const completeButton = elements.form.querySelector('[data-action="complete"]');
  prevButton.hidden = stepIndex === 0 || stepIndex === steps.length - 1;
  nextButton.hidden = stepIndex >= 4;
  completeButton.hidden = stepIndex !== 4;

  if (stepIndex === 3 || stepIndex === 5) updateDocuments();
  if (stepIndex === 4) resizeAllSignatures();
  scheduleSave();
}

function readFormIntoState() {
  const data = {};
  const formData = new FormData(elements.form);
  for (const [key, value] of formData.entries()) {
    data[key] = typeof value === "string" ? value.trim() : value;
  }

  data.principalNumber = parseMoney(data.principal);
  data.interestRateNumber = parseRate(data.interestRate);
  data.lateRateNumber = parseRate(data.lateRate);
  data.installmentCountNumber = Math.max(0, parseInt(data.installmentCount || "0", 10) || 0);
  data.repaymentSchedule = buildRepaymentSchedule(data);
  state.data = data;
}

function applyStateToForm() {
  for (const [key, value] of Object.entries(state.data)) {
    const field = elements.form.elements[key];
    if (!field || key.endsWith("Number") || key === "repaymentSchedule") continue;

    if (field instanceof RadioNodeList) {
      const option = Array.from(field).find((input) => input.value === value);
      if (option) option.checked = true;
    } else if (field.type === "checkbox") {
      field.checked = value === "on" || value === true;
    } else {
      field.value = value;
    }
  }
}

function updateAll() {
  readFormIntoState();
  updateConditionalFields();
  updateAmountPreview();
  updateSchedulePreview();
  updateSignatureTimes();
  updateDocuments();
  updateCompletionSummary();
}

function updateConditionalFields() {
  const hasInterest = state.data.interestType === "interest";
  const isInstallment = state.data.repaymentType === "installment";
  const hasGuarantor = state.data.guarantorType === "guarantor";
  document.querySelector(".interest-fields").hidden = !hasInterest;
  document.querySelector(".lump-fields").hidden = isInstallment;
  document.querySelector(".installment-fields").hidden = !isInstallment;
  document.querySelector(".guarantor-fields").hidden = !hasGuarantor;
  document.querySelector(".guarantor-sign").hidden = !hasGuarantor;

  elements.form.elements.interestRate.required = hasInterest;
  elements.form.elements.finalDueDate.required = !isInstallment;
  elements.form.elements.firstInstallmentDate.required = isInstallment;
  elements.form.elements.installmentCount.required = isInstallment;
}

function updateAmountPreview() {
  const amount = state.data.principalNumber || 0;
  elements.amountPreview.textContent = `${formatWon(amount)}원`;
  elements.amountKorean.textContent = numberToKoreanMoney(amount);
}

function updateSchedulePreview() {
  if (state.data.repaymentType !== "installment") {
    elements.schedulePreview.innerHTML = "";
    return;
  }

  const schedule = state.data.repaymentSchedule;
  if (!schedule.length) {
    elements.schedulePreview.innerHTML = `<p class="field-help">금액, 첫 상환일, 회차를 입력하면 일정이 표시됩니다.</p>`;
    return;
  }

  elements.schedulePreview.innerHTML = renderScheduleTable(schedule);
}

function updateSignatureTimes() {
  const creditor = state.signatures.creditor.signedAt;
  const debtor = state.signatures.debtor.signedAt;
  const guarantor = state.signatures.guarantor?.signedAt;
  elements.creditorSignTime.textContent = creditor ? `서명 시각: ${formatKoreanDateTime(creditor)}` : "아직 서명하지 않았습니다.";
  elements.debtorSignTime.textContent = debtor ? `서명 시각: ${formatKoreanDateTime(debtor)}` : "아직 서명하지 않았습니다.";
  elements.guarantorSignTime.textContent = guarantor ? `서명 시각: ${formatKoreanDateTime(guarantor)}` : "아직 서명하지 않았습니다.";
}

function validateCurrentStep() {
  readFormIntoState();
  clearInvalidMarks();
  let fields = [];
  let message = "";

  if (state.currentStep === 0) {
    fields = [
      "creditorName",
      "creditorRRN",
      "creditorPhone",
      "creditorAddress",
      "debtorName",
      "debtorRRN",
      "debtorPhone",
      "debtorAddress",
    ];
    if (state.data.guarantorType === "guarantor") {
      fields.push("guarantorName", "guarantorRRN", "guarantorPhone", "guarantorAddress");
    }
    message = "당사자의 필수 정보를 모두 입력해 주세요.";
    const rrnFields = ["creditorRRN", "debtorRRN"];
    if (state.data.guarantorType === "guarantor") rrnFields.push("guarantorRRN");
    for (const name of rrnFields) {
      const value = String(elements.form.elements[name]?.value || "").trim();
      if (value && !/^\d{6}-\d{7}$/.test(value)) {
        return showValidationError("주민등록번호는 000000-0000000 형식으로 입력해 주세요.", [name]);
      }
    }
  }

  if (state.currentStep === 1) {
    fields = ["principal", "loanDate", "paymentMethod"];
    if (state.data.interestType === "interest") fields.push("interestRate");
    message = "대여금액, 지급일, 이자 조건을 확인해 주세요.";
    if (!state.data.principalNumber || state.data.principalNumber < 1) {
      return showValidationError("대여금액은 1원 이상이어야 합니다.", ["principal"]);
    }
    if (state.data.interestType === "interest" && state.data.interestRateNumber > MAX_LEGAL_RATE) {
      return showValidationError("연이율은 법정 최고이자율인 연 20%를 초과할 수 없습니다.", ["interestRate"]);
    }
  }

  if (state.currentStep === 2) {
    fields = ["repaymentBank", "repaymentHolder", "repaymentAccount"];
    if (state.data.repaymentType === "lump") fields.push("finalDueDate");
    else fields.push("firstInstallmentDate", "installmentCount");
    message = "상환 방식과 상환계좌 필수 정보를 입력해 주세요.";
    if (state.data.lateRateNumber > MAX_LEGAL_RATE) {
      return showValidationError("지연손해금률은 연 20%를 초과할 수 없습니다.", ["lateRate"]);
    }
    if (state.data.repaymentType === "installment") {
      if (state.data.installmentCountNumber < 2) {
        return showValidationError("분할상환은 2회 이상이어야 합니다.", ["installmentCount"]);
      }
      if (!state.data.repaymentSchedule.length) {
        return showValidationError("분할상환 일정을 계산할 수 없습니다.", ["firstInstallmentDate", "installmentCount"]);
      }
    }
  }

  const invalid = fields.filter((name) => !String(elements.form.elements[name]?.value || "").trim());
  if (invalid.length) return showValidationError(message, invalid);

  elements.formError.textContent = "";
  return true;
}

function validateCompletion() {
  if (!validateCurrentStep()) return false;

  const agreements = ["agreeIdentity", "agreeContract", "agreeVoluntary"];
  const missingAgreement = agreements.filter((name) => !elements.form.elements[name].checked);
  if (missingAgreement.length) {
    return showValidationError("필수 확인 항목에 모두 동의해야 계약을 완료할 수 있습니다.", missingAgreement);
  }

  const missingSignatures = [];
  if (!state.signatures.creditor.dataUrl) missingSignatures.push("채권자 서명");
  if (!state.signatures.debtor.dataUrl) missingSignatures.push("채무자 서명");
  if (state.data.guarantorType === "guarantor" && !state.signatures.guarantor.dataUrl) {
    missingSignatures.push("연대보증인 서명");
  }
  if (missingSignatures.length) {
    elements.formError.textContent = `${missingSignatures.join(", ")}이 필요합니다.`;
    return false;
  }

  return true;
}

async function completeContract() {
  readFormIntoState();
  if (!validateCompletion()) return;

  state.completed.contractNumber ||= createContractNumber();
  state.completed.completedAt = new Date().toISOString();
  state.completed.documentHash = await createDocumentHash();

  updateDocuments();
  updateCompletionSummary();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(exportState()));
  goToStep(5);
}

function clearInvalidMarks() {
  elements.form.querySelectorAll("[aria-invalid]").forEach((field) => {
    field.removeAttribute("aria-invalid");
  });
}

function showValidationError(message, fieldNames) {
  elements.formError.textContent = message;
  fieldNames.forEach((name) => {
    const field = elements.form.elements[name];
    if (field instanceof RadioNodeList) {
      Array.from(field).forEach((item) => item.setAttribute("aria-invalid", "true"));
    } else if (field) {
      field.setAttribute("aria-invalid", "true");
    }
  });
  const firstField = elements.form.elements[fieldNames[0]];
  if (firstField && !(firstField instanceof RadioNodeList)) firstField.focus({ preventScroll: false });
  return false;
}

function updateDocuments() {
  const html = buildContractHtml();
  elements.reviewDocument.innerHTML = html;
  elements.printDocument.innerHTML = html;
}

function updateCompletionSummary() {
  elements.contractNumberText.textContent = state.completed.contractNumber || "-";
  elements.documentHashText.textContent = state.completed.documentHash || "-";
}

function buildContractHtml() {
  const data = state.data;
  const amount = data.principalNumber || 0;
  const creditor = data.creditorName || "채권자";
  const debtor = data.debtorName || "채무자";
  const hasGuarantor = data.guarantorType === "guarantor";
  const interestText =
    data.interestType === "interest"
      ? `연 ${formatRate(data.interestRateNumber)}%의 이자를 지급합니다.`
      : "이자는 지급하지 않는 무이자 약정입니다.";
  const repaymentText =
    data.repaymentType === "installment"
      ? `${data.installmentCountNumber}회에 걸쳐 나누어 갚습니다.`
      : `${formatDateKorean(data.finalDueDate)}까지 한 번에 갚습니다.`;
  const guarantorSummary = hasGuarantor
    ? `<p>${escapeHtml(data.guarantorName || "연대보증인")} 님이 이 채무를 연대보증합니다.</p>`
    : "";

  const partyRow = (label, creditorValue, debtorValue, guarantorValue) => {
    const guarantorCell = hasGuarantor ? `<td>${escapeHtml(guarantorValue)}</td>` : "";
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(creditorValue)}</td><td>${escapeHtml(debtorValue)}</td>${guarantorCell}</tr>`;
  };

  const partyTable = `
    <table>
      <tbody>
        <tr><th>구분</th><th>채권자</th><th>채무자</th>${hasGuarantor ? "<th>연대보증인</th>" : ""}</tr>
        ${partyRow("이름", data.creditorName, data.debtorName, data.guarantorName)}
        ${partyRow("주민등록번호", data.creditorRRN, data.debtorRRN, data.guarantorRRN)}
        ${partyRow("휴대전화번호", data.creditorPhone, data.debtorPhone, data.guarantorPhone)}
        ${partyRow("주소", data.creditorAddress, data.debtorAddress, data.guarantorAddress)}
        ${partyRow("이메일", data.creditorEmail || "미기재", data.debtorEmail || "미기재", hasGuarantor ? "미기재" : "")}
      </tbody>
    </table>
  `;

  const clauses = [];

  clauses.push(["당사자", partyTable]);

  clauses.push([
    "대여금",
    `<p>채권자는 채무자에게 대여 원금 ${escapeHtml(numberToKoreanMoney(amount))}(${escapeHtml(formatWon(amount))}원)을 ${escapeHtml(formatDateKorean(data.loanDate))}에 ${escapeHtml(data.paymentMethod || "계좌이체")} 방법으로 지급하고, 채무자는 이를 이 계약에서 정한 방법으로 갚기로 합니다.</p>
     <p>채무자의 상환 의무는 실제로 지급받은 금액을 기준으로 하며, 계좌이체 내역이나 수령 확인 기록은 대여 사실을 확인하는 자료로 사용할 수 있습니다.</p>`,
  ]);

  clauses.push(["이자", renderInterestClause(data)]);
  clauses.push(["상환 방법", renderRepaymentClause(data)]);

  clauses.push([
    "지연손해금",
    `<p>채무자가 약속한 날까지 돈을 갚지 않으면, 갚지 않은 원금에 대해 약속한 날의 다음 날부터 실제로 갚는 날까지 ${escapeHtml(renderLateRate(data))}의 지연손해금을 지급합니다.</p>
     <p>지연손해금률이 법정 최고이자율을 초과하면 법정 최고이자율까지만 적용하며, 지연손해금은 아직 갚지 않은 원금을 기준으로 계산합니다.</p>`,
  ]);

  clauses.push(["기한의 이익 상실", renderAccelerationClause(data)]);

  clauses.push([
    "조기상환과 완납 확인",
    `<p>채무자는 상환일 전이라도 원금의 전부 또는 일부를 미리 갚을 수 있습니다. 원금 일부를 미리 갚으면 그 이후의 이자는 남아 있는 원금만을 기준으로 계산합니다.</p>
     <p>채무자가 돈을 전부 갚으면 채권자는 완납확인서 또는 영수증을 발급하고, 양쪽은 계좌이체 확인증과 상환 확인 기록을 보관하는 것이 좋습니다.</p>`,
  ]);

  if (hasGuarantor) {
    clauses.push(["연대보증", renderGuarantorClause(data)]);
  }

  clauses.push([
    "연락처 또는 주소 변경",
    `<p>계약 당사자는 휴대전화번호, 주소 또는 이메일이 바뀌면 상대방에게 지체 없이 알려야 합니다. 상대방이 통지를 실제로 확인할 수 있도록 발송기록이나 수신기록을 보관합니다.</p>`,
  ]);

  clauses.push([
    "계약 변경",
    `<p>이 계약 내용을 변경하려면 채권자와 채무자가 변경된 내용을 확인하고 다시 서명해야 합니다. 전화나 말로만 합의한 내용은 상대방이 인정하지 않으면 계약 변경으로 보지 않습니다.</p>`,
  ]);

  clauses.push([
    "전자문서와 전자서명",
    `<p>계약 당사자는 이 계약서를 모바일 또는 전자문서로 작성하고 전자서명하는 것에 동의합니다. 각 당사자는 전자서명 전에 계약서 전체 내용을 확인하였으며, 서명 후 동일한 내용의 최종 계약서를 각각 보관합니다.</p>
     <p>이 계약서는 공정증서가 아니며, 이 문서만으로 곧바로 강제집행을 할 수 있다는 뜻으로 해석하지 않습니다. 금액이 크거나 담보·보증·분쟁 가능성이 있는 거래는 전문가 검토 또는 공증을 권장합니다.</p>`,
  ]);

  clauses.push([
    "관할법원과 분쟁 해결",
    `<p>분쟁이 생기면 먼저 대화와 서면 협의를 통해 해결하도록 노력합니다.</p>
     <p>협의로 해결되지 않으면 ${data.court ? escapeHtml(data.court) : "채권자의 주소지를 관할하는 법원"}을 제1심 관할법원으로 하기로 합의합니다.</p>`,
  ]);

  if (data.specialTerms) {
    clauses.push(["추가 약속", `<p>${escapeHtml(data.specialTerms)}</p>`]);
  }

  const clausesHtml = clauses
    .map(([title, body], index) => `<h2>제${index + 1}조 ${escapeHtml(title)}</h2>${body}`)
    .join("");

  return `
    <h1>금전소비대차계약서</h1>
    <div class="contract-meta">
      <p><strong>계약번호</strong><br>${escapeHtml(state.completed.contractNumber || "계약 완료 시 자동 생성")}</p>
      <p><strong>작성일</strong><br>${escapeHtml(formatDateKorean(data.loanDate || todayInput()))}</p>
      <p><strong>문서 확인값</strong><br>${escapeHtml(state.completed.documentHash || "계약 완료 시 SHA-256 생성")}</p>
      <p><strong>완료 시각</strong><br>${escapeHtml(state.completed.completedAt ? formatKoreanDateTime(state.completed.completedAt) : "계약 완료 전")}</p>
    </div>

    <h2>쉬운 말 요약</h2>
    <p>${escapeHtml(creditor)} 님은 ${escapeHtml(debtor)} 님에게 ${escapeHtml(formatWon(amount))}원을 빌려줍니다.</p>
    <p>대여금은 ${escapeHtml(numberToKoreanMoney(amount))}으로 표시하며, ${escapeHtml(repaymentText)}</p>
    <p>${escapeHtml(interestText)} 상환금은 ${escapeHtml(data.repaymentBank || "-")} ${escapeHtml(data.repaymentAccount || "-")} 계좌로 보냅니다.</p>
    ${guarantorSummary}

    ${clausesHtml}

    <h2>계약 체결 확인</h2>
    <p>계약 당사자는 위 계약 내용을 모두 확인하고 각각 서명합니다.</p>
    <div class="signature-print-grid">
      ${renderSignatureBlock("채권자", data.creditorName, state.signatures.creditor)}
      ${renderSignatureBlock("채무자", data.debtorName, state.signatures.debtor)}
      ${hasGuarantor ? renderSignatureBlock("연대보증인", data.guarantorName, state.signatures.guarantor) : ""}
    </div>
  `;
}

function renderAccelerationClause(data) {
  const isInstallment = data.repaymentType === "installment";
  const hasInterest = data.interestType === "interest";
  const reasons = [];
  if (isInstallment) reasons.push("분할상환금을 2회 연속 갚지 않은 때");
  if (hasInterest) reasons.push("이자 지급을 2회 연속 지체한 때");
  reasons.push("채권자가 미납 사실을 통지한 후 14일이 지나도록 갚지 않은 때");
  reasons.push("채무자가 다른 채권자로부터 가압류·압류·강제집행을 당하거나 파산·회생 절차가 개시된 때");
  reasons.push("채무자가 연락처나 주소가 바뀌었는데도 알리지 않아 연락이 닿지 않는 때");

  const items = reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  return `
    <p>채무자에게 다음 사유가 생기면 채무자는 기한의 이익을 잃고, 채권자는 남아 있는 원금과 미지급 이자를 한꺼번에 갚으라고 요구할 수 있습니다.</p>
    <ol>${items}</ol>
    <p>채권자가 위 권리를 행사하려면 채무자에게 남은 원금, 미지급 이자 및 지급기한을 문자, 이메일, 카카오톡 또는 서면으로 구체적으로 알려야 합니다.</p>
  `;
}

function renderGuarantorClause(data) {
  return `
    <p>연대보증인 ${escapeHtml(data.guarantorName || "-")}은(는) 이 계약에 따라 채무자가 부담하는 원금, 이자 및 지연손해금 지급채무를 채무자와 연대하여 보증합니다.</p>
    <p>연대보증인은 이 계약서의 내용을 모두 확인하였으며, 「민법」 제428조의2에 따라 보증 의사를 표시하기 위하여 이 서면에 직접 서명합니다.</p>
  `;
}

function renderInterestClause(data) {
  if (data.interestType !== "interest") {
    return `<p>채무자는 원금만 갚고 이자는 지급하지 않습니다.</p>`;
  }

  return `
    <p>채무자는 원금에 대해 연 ${escapeHtml(formatRate(data.interestRateNumber))}%의 이자를 지급합니다. 이자는 실제로 돈을 받은 날의 다음 날부터 원금을 모두 갚는 날까지 계산합니다.</p>
    <p>이자 지급 방법은 ${escapeHtml(data.interestPayment || "원금 상환일에 함께 지급")}으로 합니다. 약정이자와 돈을 빌려주는 대가로 받는 수수료 등의 합계가 법에서 정한 최고이자율을 초과하는 경우에는 법정 최고이자율까지만 적용합니다.</p>
  `;
}

function renderRepaymentClause(data) {
  if (data.repaymentType === "installment") {
    return `
      <p>채무자는 아래 일정에 따라 원금을 나누어 갚습니다. 원 단위 차이는 마지막 회차에서 정리합니다.</p>
      ${renderScheduleTable(data.repaymentSchedule)}
      <p>상환계좌는 ${escapeHtml(data.repaymentBank || "-")} / 예금주 ${escapeHtml(data.repaymentHolder || "-")} / 계좌번호 ${escapeHtml(data.repaymentAccount || "-")}입니다.</p>
    `;
  }

  return `
    <p>채무자는 ${escapeHtml(formatDateKorean(data.finalDueDate))}까지 원금 전액과 지급하지 않은 이자를 한 번에 갚습니다.</p>
    <p>상환계좌는 ${escapeHtml(data.repaymentBank || "-")} / 예금주 ${escapeHtml(data.repaymentHolder || "-")} / 계좌번호 ${escapeHtml(data.repaymentAccount || "-")}입니다.</p>
  `;
}

function renderLateRate(data) {
  if (!data.lateRate && data.lateRate !== "0") return "별도로 정하지 않고 법에서 정한 이율";
  return `연 ${formatRate(data.lateRateNumber)}%`;
}

function renderSignatureBlock(role, name, signature) {
  const image = signature.dataUrl
    ? `<img src="${signature.dataUrl}" alt="${escapeHtml(role)} 서명 이미지">`
    : `<p>서명 전</p>`;
  return `
    <section class="signature-print-box">
      <h3>${escapeHtml(role)} 서명</h3>
      <p>이름: ${escapeHtml(name || "-")}</p>
      ${image}
      <p>서명 시각: ${escapeHtml(signature.signedAt ? formatKoreanDateTime(signature.signedAt) : "-")}</p>
    </section>
  `;
}

function renderScheduleTable(schedule) {
  if (!schedule.length) return "";

  const rows = schedule
    .map(
      (item) => `
        <tr>
          <td>${item.round}회</td>
          <td>${escapeHtml(formatDateKorean(item.date))}</td>
          <td>${escapeHtml(formatWon(item.principal))}원</td>
          <td>${escapeHtml(formatWon(item.interest))}원</td>
          <td>${escapeHtml(formatWon(item.total))}원</td>
        </tr>
      `,
    )
    .join("");

  return `
    <table>
      <thead>
        <tr><th>회차</th><th>갚는 날짜</th><th>원금</th><th>예상 이자</th><th>합계</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildRepaymentSchedule(data) {
  if (data.repaymentType !== "installment") return [];
  const principal = data.principalNumber || 0;
  const count = data.installmentCountNumber || 0;
  const firstDate = parseDateInput(data.firstInstallmentDate);
  if (!principal || count < 2 || !firstDate) return [];

  const base = Math.floor(principal / count);
  const remainder = principal - base * count;
  const annualRate = data.interestType === "interest" ? data.interestRateNumber || 0 : 0;
  let remainingPrincipal = principal;

  return Array.from({ length: count }, (_, index) => {
    const round = index + 1;
    const principalForRound = round === count ? base + remainder : base;
    const interest = Math.round((remainingPrincipal * annualRate) / 100 / 12);
    const date = formatDateInput(addMonths(firstDate, index));
    remainingPrincipal -= principalForRound;
    return {
      round,
      date,
      principal: principalForRound,
      interest,
      total: principalForRound + interest,
    };
  });
}

function initializeSignatures() {
  createSignaturePad("creditor", document.querySelector("#creditorCanvas"));
  createSignaturePad("debtor", document.querySelector("#debtorCanvas"));
  createSignaturePad("guarantor", document.querySelector("#guarantorCanvas"));
  window.addEventListener("resize", debounce(resizeAllSignatures, 160));
  window.addEventListener("orientationchange", () => setTimeout(resizeAllSignatures, 250));
}

function createSignaturePad(type, canvas) {
  const context = canvas.getContext("2d");
  const pad = {
    canvas,
    context,
    drawing: false,
    lastPoint: null,
    resize: () => resizeSignatureCanvas(type),
    clear: () => {
      const ratio = window.devicePixelRatio || 1;
      context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      drawSignatureGuide(context, canvas);
    },
  };

  signaturePads.set(type, pad);
  pad.resize();

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pad.drawing = true;
    pad.lastPoint = getCanvasPoint(canvas, event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pad.drawing) return;
    event.preventDefault();
    const point = getCanvasPoint(canvas, event);
    drawSignatureLine(context, pad.lastPoint, point);
    pad.lastPoint = point;
  });

  const finish = (event) => {
    if (!pad.drawing) return;
    event.preventDefault();
    pad.drawing = false;
    pad.lastPoint = null;
    state.signatures[type] = {
      dataUrl: canvas.toDataURL("image/png"),
      signedAt: new Date().toISOString(),
    };
    updateSignatureTimes();
    scheduleSave();
  };

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", finish);
}

function resizeAllSignatures() {
  signaturePads.forEach((pad) => pad.resize());
}

function resizeSignatureCanvas(type) {
  const pad = signaturePads.get(type);
  if (!pad) return;
  const { canvas, context } = pad;
  const dataUrl = state.signatures[type].dataUrl || canvas.toDataURL("image/png");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.4;
  context.strokeStyle = "#17221d";
  drawSignatureGuide(context, canvas);

  if (dataUrl && !isBlankSignature(dataUrl)) {
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, rect.width, rect.height);
      if (state.signatures[type].dataUrl) {
        state.signatures[type].dataUrl = canvas.toDataURL("image/png");
      }
    };
    image.src = dataUrl;
  }
}

function drawSignatureGuide(context, canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  context.save();
  context.strokeStyle = "rgba(35, 68, 59, 0.18)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(14, height * 0.72);
  context.lineTo(width - 14, height * 0.72);
  context.stroke();
  context.restore();
}

function drawSignatureLine(context, from, to) {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function getCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function isBlankSignature(dataUrl) {
  return !dataUrl || dataUrl.length < 500;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDraft, 250);
}

function saveDraft() {
  if (state.currentStep === steps.length - 1) return;
  readFormIntoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exportState()));
}

function restoreDraft() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(COMPLETED_STORAGE_KEY);
  if (!saved) {
    readFormIntoState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    state.currentStep = parsed.currentStep || 0;
    state.data = parsed.data || {};
    state.signatures = {
      creditor: { dataUrl: "", signedAt: "" },
      debtor: { dataUrl: "", signedAt: "" },
      guarantor: { dataUrl: "", signedAt: "" },
      ...(parsed.signatures || {}),
    };
    state.completed = parsed.completed || state.completed;
    applyStateToForm();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function exportState() {
  readFormIntoState();
  return {
    version: 2,
    currentStep: state.currentStep,
    data: state.data,
    signatures: state.signatures,
    completed: state.completed,
    exportedAt: new Date().toISOString(),
  };
}

function resetApp() {
  if (!confirm("작성 중인 내용과 현재 서명을 지우고 새 차용증을 작성할까요?")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(COMPLETED_STORAGE_KEY);
  elements.form.reset();
  state.currentStep = 0;
  state.data = {};
  state.signatures = {
    creditor: { dataUrl: "", signedAt: "" },
    debtor: { dataUrl: "", signedAt: "" },
    guarantor: { dataUrl: "", signedAt: "" },
  };
  state.completed = { contractNumber: "", completedAt: "", documentHash: "" };
  setDefaultDates();
  signaturePads.forEach((pad) => pad.clear());
  showWorkspace();
  updateAll();
}

async function createDocumentHash() {
  const payload = JSON.stringify({
    data: state.data,
    signatures: state.signatures,
    contractNumber: state.completed.contractNumber,
    completedAt: state.completed.completedAt,
  });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createContractNumber() {
  const now = new Date();
  const date = formatDateInput(now).replaceAll("-", "");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join("");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LN-${date}-${time}-${random}`;
}

const STANDALONE_DOCUMENT_CSS = `
  body { max-width: 760px; margin: 0 auto; padding: 32px 20px; color: #111;
    font-family: -apple-system, 'SF Pro Text', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
  h1 { font-size: 26px; text-align: center; margin: 0 0 20px; }
  h2 { font-size: 16px; margin: 22px 0 8px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  p { margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #D4D4D8; padding: 7px 8px; text-align: left; font-size: 13px; vertical-align: top; }
  th { background: #F3F3F5; }
  ol { padding-left: 22px; margin: 6px 0; }
  li { margin-bottom: 3px; }
  .contract-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    border: 1px solid #D4D4D8; border-radius: 8px; padding: 12px; margin: 14px 0; font-size: 12.5px; }
  .signature-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
  .signature-print-box { border: 1px solid #888; border-radius: 8px; padding: 12px; min-height: 150px; }
  .signature-print-box img { display: block; max-width: 100%; height: 82px; margin: 8px 0;
    object-fit: contain; border-bottom: 1px solid #aaa; }
  @media print { @page { size: A4; margin: 14mm; } body { padding: 0; } }
`;

function downloadFinalHtml() {
  updateDocuments();
  const title = `easy-loan-note-${state.completed.contractNumber || "draft"}.html`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STANDALONE_DOCUMENT_CSS}</style></head><body><article>${elements.printDocument.innerHTML}</article></body></html>`;
  downloadBlob(title, html, "text/html;charset=utf-8");
}

function downloadJsonBackup() {
  const title = `easy-loan-note-${state.completed.contractNumber || "draft"}.json`;
  downloadBlob(title, JSON.stringify(exportState(), null, 2), "application/json;charset=utf-8");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseMoney(value) {
  return Number(String(value || "").replace(/[^\d]/g, "")) || 0;
}

function formatAmountInput(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

function formatWon(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function parseRate(value) {
  const parsed = Number.parseFloat(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRate(value) {
  return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function numberToKoreanMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "금 영원정";
  const digits = String(Math.trunc(amount));
  const groupUnits = ["", "만", "억", "조", "경"];
  const groups = [];

  for (let end = digits.length; end > 0; end -= 4) {
    const start = Math.max(0, end - 4);
    groups.unshift(Number(digits.slice(start, end)));
  }

  const text = groups
    .map((group, index) => {
      if (!group) return "";
      const unit = groupUnits[groups.length - 1 - index] || "";
      return `${koreanFourDigit(group)}${unit}`;
    })
    .join("");

  return `금 ${text}원정`;
}

function koreanFourDigit(value) {
  const nums = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const units = ["천", "백", "십", ""];
  const padded = String(value).padStart(4, "0");
  return padded
    .split("")
    .map((digit, index) => {
      const num = Number(digit);
      return num ? `${nums[num]}${units[index]}` : "";
    })
    .join("");
}

function formatRRN(value) {
  const digits = String(value || "").replace(/[^\d]/g, "").slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

function formatPhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function formatDateInput(date) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return "";
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayInput() {
  return formatDateInput(new Date());
}

function parseDateInput(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addMonths(date, monthCount) {
  const source = date instanceof Date ? date : new Date(date);
  const target = new Date(source.getFullYear(), source.getMonth() + monthCount, 1);
  const maxDate = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(source.getDate(), maxDate));
  return target;
}

function formatDateKorean(value) {
  const date = parseDateInput(value);
  if (!date) return value || "-";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatKoreanDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(callback, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // 로컬 파일로 직접 열었거나 브라우저가 차단한 경우에는 조용히 넘어갑니다.
    });
  });
}
