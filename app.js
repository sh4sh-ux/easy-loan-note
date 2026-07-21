"use strict";

// 화면에 표시하는 버전(진실의 원천). 버전 올릴 때 index.html·service-worker.js와 함께 갱신.
const APP_VERSION = "v30";
const STORAGE_KEY = "easy-loan-note:draft:v3";
const COMPLETED_STORAGE_KEY = "easy-loan-note:completed:v3";
const ARCHIVE_KEY = "easy-loan-note:archive:v1";
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
  attachments: [],
  audit: [],
  includeAudit: false,
  completed: {
    contractNumber: "",
    completedAt: "",
    documentHash: "",
    userAgent: "",
    timeZone: "",
  },
};

function logEvent(label) {
  state.audit.push({ label, at: new Date().toISOString() });
}

function logEventOnce(label) {
  if (!state.audit.some((entry) => entry.label === label)) logEvent(label);
}

function logSignatureEvent(type) {
  const role = { creditor: "채권자", debtor: "채무자", guarantor: "연대보증인" }[type] || type;
  logEvent(`${role} 서명 완료`);
}

const elements = {};
const signaturePads = new Map();
let deferredInstallPrompt = null;
let saveTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  renderVersion();
  setDefaultDates();
  renderStepList();
  bindEvents();
  restoreDraft();
  initializeSignatures();
  registerServiceWorker();
  renderAttachmentList();
  updateAll();
  renderResumeCard();
  initDropbox();
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
  elements.archive = document.querySelector(".archive");
  elements.archiveList = document.querySelector("#archiveList");
  elements.dbxPanel = document.querySelector("#dbxPanel");
  elements.resumeCard = document.querySelector("#resumeCard");
  elements.saveBadge = document.querySelector("#saveBadge");
  elements.importDraftInput = document.querySelector("#importDraftInput");
  elements.attachmentInput = document.querySelector("#attachmentInput");
  elements.attachmentList = document.querySelector("#attachmentList");
  elements.importJsonInput = document.querySelector("#importJsonInput");
  elements.signModal = document.querySelector("#signModal");
  elements.signModalTitle = document.querySelector("#signModalTitle");
  elements.signModalStage = document.querySelector("#signModalStage");
  elements.signModalCanvas = document.querySelector("#signModalCanvas");
  elements.includeAuditToggle = document.querySelector("#includeAuditToggle");
  elements.versionChip = document.querySelector("#versionChip");
}

function renderVersion() {
  if (elements.versionChip) elements.versionChip.textContent = APP_VERSION;
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
  elements.attachmentInput.addEventListener("change", async () => {
    await handleAttachmentFiles(elements.attachmentInput.files);
    elements.attachmentInput.value = "";
  });
  elements.importJsonInput.addEventListener("change", async () => {
    const file = elements.importJsonInput.files[0];
    elements.importJsonInput.value = "";
    if (file) await importJsonBackup(file);
  });
  elements.importDraftInput.addEventListener("change", async () => {
    const file = elements.importDraftInput.files[0];
    elements.importDraftInput.value = "";
    if (file) await importDraftFile(file);
  });
  elements.includeAuditToggle.addEventListener("change", () => {
    state.includeAudit = elements.includeAuditToggle.checked;
    updateDocuments();
    persistCompleted();
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

function openPostcodeSearch(fieldName) {
  if (typeof daum === "undefined" || !daum.Postcode) {
    alert("주소 검색 서비스를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "postcode-overlay";
  const box = document.createElement("div");
  box.className = "postcode-box";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "postcode-close";
  closeBtn.textContent = "\u2715 닫기";
  const embedTarget = document.createElement("div");
  embedTarget.className = "postcode-embed";
  box.append(closeBtn, embedTarget);
  overlay.append(box);
  document.body.append(overlay);

  const remove = () => {
    if (overlay.parentNode) overlay.remove();
  };
  closeBtn.addEventListener("click", remove);

  new daum.Postcode({
    oncomplete(data) {
      const base = document.querySelector('[name="' + fieldName + '"]');
      if (base) {
        let addr = data.roadAddress || data.address || "";
        // 아파트·건물명이 있으면 괄호로 덧붙임 (예: "... 학동로63길 13 (청담 영풍 마드레빌 아파트)")
        if (data.buildingName) {
          addr += " (" + data.buildingName + ")";
        }
        base.value = addr;
        base.dispatchEvent(new Event("input", { bubbles: true }));
      }
      remove();
      // 도로명주소를 채운 뒤 상세주소 입력란으로 커서 이동
      const detail = document.querySelector('[name="' + fieldName + 'Detail"]');
      if (detail) detail.focus();
    },
    onclose() {
      remove();
    },
    width: "100%",
    height: "100%",
  }).embed(embedTarget);
}

function handleDocumentClick(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const action = button.dataset.action;
  const clearSignature = button.dataset.clearSignature;

  if (clearSignature) {
    state.signatures[clearSignature] = { dataUrl: "", signedAt: "" };
    signaturePads.get(clearSignature)?.clear();
    updateSignatureTimes();
    scheduleSave();
    return;
  }

  if (button.dataset.signModal) {
    const modalAction = button.dataset.signModal;
    if (modalAction === "confirm") confirmSignModal();
    else if (modalAction === "clear") signModalPad?.clear();
    else if (modalAction === "cancel") closeSignModal();
    return;
  }

  if (button.dataset.postcode) {
    openPostcodeSearch(button.dataset.postcode);
    return;
  }

  if (button.dataset.removeAttachment) {
    removeAttachment(button.dataset.removeAttachment);
    return;
  }

  if (button.dataset.openArchive) {
    openArchivedContract(button.dataset.openArchive);
    return;
  }

  if (button.dataset.deleteArchive) {
    deleteArchivedContract(button.dataset.deleteArchive);
    return;
  }

  if (!action) return;

  switch (action) {
    case "start":
      if (hasDraftContent()) {
        if (confirm("작성 중인 내용이 있습니다. 지우고 새로 시작할까요?\n(취소를 누르면 이어서 작성합니다)")) {
          clearAllState();
        }
      }
      logEventOnce("작성 시작");
      showWorkspace();
      updateAll();
      break;
    case "restore":
      showWorkspace();
      break;
    case "import-json":
      elements.importJsonInput.click();
      break;
    case "prev":
      goToStep(Math.max(0, state.currentStep - 1));
      scrollToWorkspaceTop();
      break;
    case "next":
      if (validateCurrentStep()) {
        goToStep(Math.min(steps.length - 1, state.currentStep + 1));
        scrollToWorkspaceTop();
      }
      break;
    case "complete":
      completeContract();
      break;
    case "print":
      updateDocuments();
      window.print();
      break;
    case "download-pdf":
      runExport(button, downloadContractPdf);
      break;
    case "download-image":
      runExport(button, downloadContractImage);
      break;
    case "add-attachment":
      elements.attachmentInput.click();
      break;
    case "home":
      backToIntro();
      break;
    case "download-draft-file":
      downloadDraftFile();
      break;
    case "import-draft-file":
      elements.importDraftInput.click();
      break;
    case "archive":
      showArchive();
      break;
    case "close-archive":
      closeArchive();
      break;
    case "dbx-connect":
      dbxConnect();
      break;
    case "dbx-sync":
      runDbxSync(button);
      break;
    case "dbx-disconnect":
      dbxDisconnect();
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

  // 필수 확인(동의) 체크 시각 기록
  const agreementLabels = {
    agreeIdentity: "동의: 서로의 신원·연락처 확인",
    agreeContract: "동의: 대여금·이자·상환 조건 확인",
    agreeVoluntary: "동의: 강요 없이 본인 의사로 서명",
  };
  if (agreementLabels[target.name] && target.checked) {
    logEventOnce(agreementLabels[target.name]);
  }

  // 완료된 계약을 수정하면 완료 시각·문서 확인값을 무효화 (다시 '계약 완료' 필요)
  if (state.completed.completedAt) {
    state.completed.completedAt = "";
    state.completed.documentHash = "";
    logEvent("완료 후 내용 수정");
  }

  readFormIntoState();
  updateAll();
  scheduleSave();
}

function showWorkspace() {
  elements.intro.hidden = true;
  elements.archive.hidden = true;
  elements.workspace.hidden = false;
  const snap = getDraftSnapshot();
  if (snap && snap.exportedAt) updateSaveBadge(snap.exportedAt);
  goToStep(state.currentStep);
}

function showArchive() {
  renderArchiveList();
  renderDbxPanel();
  elements.intro.hidden = true;
  elements.workspace.hidden = true;
  elements.archive.hidden = false;
}

function closeArchive() {
  elements.archive.hidden = true;
  elements.intro.hidden = false;
  renderResumeCard();
}

// 작성 화면에서 인트로로 돌아가기 (작성 내용은 저장돼 있어 '이어서 작성'으로 이어감)
function backToIntro() {
  elements.workspace.hidden = true;
  elements.archive.hidden = true;
  elements.intro.hidden = false;
  renderResumeCard();
  window.scrollTo({ top: 0 });
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
    .map((label, index) => `<li data-step-index="${index}" role="button" tabindex="0">${index + 1}. ${escapeHtml(label)}</li>`)
    .join("");
  elements.stepList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-step-index]");
    if (!item) return;
    requestStep(Number(item.dataset.stepIndex));
  });
}

// 단계 전환 시 항상 상단부터 보이도록 (데스크탑에서 프레임이 튀어 보이지 않게)
function scrollToWorkspaceTop() {
  window.scrollTo({ top: 0 });
}

function requestStep(target) {
  if (!Number.isInteger(target) || target === state.currentStep) return;

  // 뒤로는 자유롭게 이동
  if (target < state.currentStep) {
    goToStep(target);
    scrollToWorkspaceTop();
    return;
  }

  // 완료 화면은 '계약 완료'를 거쳐야만 진입 (완료된 계약은 바로 이동 가능)
  const maxStep = state.completed.completedAt ? 5 : 4;
  const cappedTarget = Math.min(target, maxStep);

  // 앞으로는 중간 단계를 순차 검증하며 이동
  while (state.currentStep < cappedTarget) {
    if (state.currentStep < 3 && !validateCurrentStep()) return;
    goToStep(state.currentStep + 1);
  }
  scrollToWorkspaceTop();

  if (target > maxStep) {
    elements.formError.textContent = "서명 단계에서 '계약 완료'를 누르면 완료 화면으로 이동합니다.";
  }
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

  elements.progressFill.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
  const prevButton = elements.form.querySelector('[data-action="prev"]');
  const nextButton = elements.form.querySelector('[data-action="next"]');
  const completeButton = elements.form.querySelector('[data-action="complete"]');
  prevButton.hidden = stepIndex === 0;
  nextButton.hidden = stepIndex >= 4;
  completeButton.hidden = stepIndex !== 4;

  if (stepIndex === 3 || stepIndex === 5) updateDocuments();
  if (stepIndex === 5) updateCompletionSummary();
  if (stepIndex === 3) logEventOnce("계약서 전체 열람");
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

  logEvent("계약 완료");
  state.completed.contractNumber ||= createContractNumber();
  state.completed.completedAt = new Date().toISOString();
  try {
    state.completed.userAgent = navigator.userAgent || "";
    state.completed.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* 환경 정보 수집 실패는 무시 */
  }
  // 문서 확인값은 서명·별첨·진행기록까지 모두 확정된 뒤 계산한다
  state.completed.documentHash = await createDocumentHash();

  updateDocuments();
  updateCompletionSummary();
  state.currentStep = 5;
  localStorage.removeItem(STORAGE_KEY);
  window.clearTimeout(draftDbxTimer);
  dbxDeleteDraft().catch(() => {}); // 완료된 초안은 원격에서도 제거
  try {
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(exportState()));
  } catch {
    // 저장 공간 부족 시에도 완료 화면은 진행
  }
  archiveCurrentContract();
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
  if (elements.includeAuditToggle) elements.includeAuditToggle.checked = state.includeAudit;
}

function persistCompleted() {
  if (!state.completed.completedAt) return;
  try {
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(exportState()));
  } catch {
    /* 저장 공간 부족은 무시 */
  }
  archiveCurrentContract();
}

/* ── 첨부자료 ── */

async function handleAttachmentFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const dataUrl = await compressImageFile(file);
      state.attachments.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        dataUrl,
      });
    } catch {
      alert(`${file.name} 파일을 읽지 못했습니다.`);
    }
  }
  renderAttachmentList();
  updateDocuments();
  scheduleSave();
}

async function compressImageFile(file) {
  const MAX_EDGE = 1200;
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode failed"));
      };
      image.src = url;
    });
  }
  const width = source.width;
  const height = source.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function renderAttachmentList() {
  if (!state.attachments.length) {
    elements.attachmentList.innerHTML = `<p class="field-help">첨부된 사진이 없습니다.</p>`;
    return;
  }
  elements.attachmentList.innerHTML = state.attachments
    .map(
      (attachment, index) => `
        <div class="attachment-item">
          <img src="${attachment.dataUrl}" alt="별첨 ${index + 1}">
          <span class="attachment-name">별첨 ${index + 1} · ${escapeHtml(attachment.name)}</span>
          <button class="danger-button small" type="button" data-remove-attachment="${escapeHtml(attachment.id)}">삭제</button>
        </div>
      `,
    )
    .join("");
}

function removeAttachment(id) {
  state.attachments = state.attachments.filter((attachment) => attachment.id !== id);
  renderAttachmentList();
  updateDocuments();
  scheduleSave();
}

/* ── 계약 보관함 ── */

function loadArchive() {
  try {
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveArchiveList(list) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
}

function archiveCurrentContract() {
  const entry = {
    id: state.completed.contractNumber,
    savedAt: new Date().toISOString(),
    summary: {
      creditor: state.data.creditorName || "-",
      debtor: state.data.debtorName || "-",
      amount: state.data.principalNumber || 0,
      completedAt: state.completed.completedAt,
    },
    snapshot: exportState(),
  };
  const list = loadArchive().filter((item) => item.id !== entry.id);
  list.unshift(entry);
  try {
    saveArchiveList(list);
  } catch {
    alert(
      "보관함 저장 공간이 부족하여 이 계약을 보관하지 못했습니다. JSON 백업으로 저장해 두시고, 보관함에서 오래된 계약을 삭제하면 공간이 생깁니다.",
    );
  }
  // 연결돼 있으면 Dropbox에도 자동 백업
  dbxAutoSync();
}

function renderArchiveList() {
  const list = loadArchive();
  if (!list.length) {
    elements.archiveList.innerHTML = `<li class="archive-empty">보관된 계약이 없습니다. 계약을 완료하면 자동으로 저장됩니다.</li>`;
    return;
  }
  elements.archiveList.innerHTML = list
    .map(
      (item) => `
        <li class="archive-item">
          <div class="archive-info">
            <strong>${escapeHtml(item.summary.creditor)} → ${escapeHtml(item.summary.debtor)}</strong>
            <span>${escapeHtml(formatWon(item.summary.amount))}원 · ${escapeHtml(item.summary.completedAt ? formatKoreanDateTime(item.summary.completedAt) : "-")}</span>
            <span class="archive-id">${escapeHtml(item.id)}</span>
          </div>
          <div class="archive-actions">
            <button class="secondary-button small" type="button" data-open-archive="${escapeHtml(item.id)}">열기</button>
            <button class="danger-button small" type="button" data-delete-archive="${escapeHtml(item.id)}">삭제</button>
          </div>
        </li>
      `,
    )
    .join("");
}

function openArchivedContract(id) {
  const item = loadArchive().find((entry) => entry.id === id);
  if (!item || !item.snapshot) return;
  const snapshot = item.snapshot;
  state.data = snapshot.data || {};
  state.signatures = {
    creditor: { dataUrl: "", signedAt: "" },
    debtor: { dataUrl: "", signedAt: "" },
    guarantor: { dataUrl: "", signedAt: "" },
    ...(snapshot.signatures || {}),
  };
  state.attachments = snapshot.attachments || [];
  state.audit = snapshot.audit || [];
  state.includeAudit = Boolean(snapshot.includeAudit);
  state.completed = snapshot.completed || { contractNumber: "", completedAt: "", documentHash: "", userAgent: "", timeZone: "" };
  applyStateToForm();
  renderAttachmentList();
  state.currentStep = steps.length - 1;
  showWorkspace();
  updateAll();
}

function deleteArchivedContract(id) {
  if (!confirm("이 계약을 보관함에서 삭제할까요? 삭제하면 되돌릴 수 없습니다.")) return;
  saveArchiveList(loadArchive().filter((entry) => entry.id !== id));
  renderArchiveList();
  // 삭제는 병합(union) 없이 바로 올려서 Dropbox에서도 지워지게 함
  dbxAutoPush();
}

/* ── Dropbox 보관함 백업 (App folder / PKCE) ── */

const DBX_APPKEY_KEY = "easy-loan-note:dbx:appkey";
const DBX_REFRESH_KEY = "easy-loan-note:dbx:refresh";
const DBX_TOKEN_KEY = "easy-loan-note:dbx:token";
const DBX_ACCOUNT_KEY = "easy-loan-note:dbx:account";
const DBX_VERIFIER_KEY = "easy-loan-note:dbx:verifier";
const DBX_LASTSYNC_KEY = "easy-loan-note:dbx:lastsync";
// App folder 스코프이므로 이 경로는 실제로 /Apps/<앱>/ 아래에 매핑됨. ASCII만 사용(한글 헤더 문제 회피).
const DBX_ARCHIVE_PATH = "/easy-loan-note-archive.json";

function dbxConnected() {
  return Boolean(localStorage.getItem(DBX_REFRESH_KEY));
}

function dbxAccountLabel() {
  try {
    const account = JSON.parse(localStorage.getItem(DBX_ACCOUNT_KEY) || "null");
    if (!account) return "";
    return [account.name, account.email].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}

function dbxBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function dbxRandomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return dbxBase64Url(bytes);
}

async function dbxCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return dbxBase64Url(new Uint8Array(digest));
}

function dbxRedirectUri() {
  return location.origin + location.pathname;
}

async function dbxConnect() {
  const input = document.querySelector("#dbxAppKey");
  const appKey = (input ? input.value : "").trim();
  if (!appKey) {
    alert("Dropbox App Key를 입력해 주세요.");
    return;
  }
  localStorage.setItem(DBX_APPKEY_KEY, appKey);
  const verifier = dbxRandomVerifier();
  localStorage.setItem(DBX_VERIFIER_KEY, verifier);
  const challenge = await dbxCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: appKey,
    redirect_uri: dbxRedirectUri(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  });
  location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
}

async function dbxCompleteAuth(code) {
  const appKey = localStorage.getItem(DBX_APPKEY_KEY);
  const verifier = localStorage.getItem(DBX_VERIFIER_KEY);
  if (!appKey || !verifier) return;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: appKey,
        redirect_uri: dbxRedirectUri(),
        code_verifier: verifier,
      }),
    });
    const data = await res.json();
    if (data.refresh_token) localStorage.setItem(DBX_REFRESH_KEY, data.refresh_token);
    if (data.access_token) localStorage.setItem(DBX_TOKEN_KEY, data.access_token);
    if (data.access_token) {
      try {
        const accountRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
          method: "POST",
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        const account = await accountRes.json();
        localStorage.setItem(
          DBX_ACCOUNT_KEY,
          JSON.stringify({ name: account.name?.display_name || "", email: account.email || "" }),
        );
      } catch {
        // 계정 정보 조회 실패는 무시 (연결 자체는 성공)
      }
    }
  } catch {
    alert("Dropbox 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    localStorage.removeItem(DBX_VERIFIER_KEY);
  }
}

async function dbxRefreshToken() {
  const refresh = localStorage.getItem(DBX_REFRESH_KEY);
  const appKey = localStorage.getItem(DBX_APPKEY_KEY);
  if (!refresh || !appKey) return null;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: appKey }),
    });
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem(DBX_TOKEN_KEY, data.access_token);
      return data.access_token;
    }
  } catch {
    // 네트워크 오류 등은 null 반환
  }
  return null;
}

// 마지막 Dropbox 오류를 사람이 읽을 수 있는 안내로 보관 (동기화 실패 시 표시)
let dbxLastError = "";

function dbxSetError(status, bodyText) {
  const body = (bodyText || "").slice(0, 400);
  if (status === "network") {
    dbxLastError = "네트워크에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  } else if (status === "parse") {
    dbxLastError = "Dropbox의 백업 파일을 읽지 못했습니다(형식 오류).";
  } else if (status === 401 && /missing_scope/.test(body)) {
    dbxLastError =
      "Dropbox 앱에 파일 권한이 없습니다. 개발자 콘솔 → Permissions에서 " +
      "files.content.write · files.content.read를 켜고 Submit한 뒤, 아래 '연결 해제'를 누르고 다시 연결해 주세요.";
  } else if (status === 401) {
    dbxLastError = "Dropbox 인증이 만료되었거나 유효하지 않습니다. '연결 해제' 후 다시 연결해 주세요.";
  } else if (status === 403) {
    dbxLastError = "Dropbox 접근이 거부되었습니다(권한 부족). 개발자 콘솔에서 앱 권한을 확인해 주세요.";
  } else {
    dbxLastError = `Dropbox 오류 (${status})` + (body ? `: ${body}` : "");
  }
}

async function dbxPushArchive() {
  if (!dbxConnected()) return false;
  const body = JSON.stringify(loadArchive());
  const arg = JSON.stringify({ path: DBX_ARCHIVE_PATH, mode: "overwrite", autorename: false, mute: true });
  const upload = (token) =>
    fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": arg,
      },
      body,
    });
  try {
    let token = localStorage.getItem(DBX_TOKEN_KEY);
    let res = token ? await upload(token) : null;
    if (!res || res.status === 401) {
      token = await dbxRefreshToken();
      if (token) res = await upload(token);
    }
    if (res && res.ok) return true;
    dbxSetError(res ? res.status : 401, res ? await res.text().catch(() => "") : "");
    return false;
  } catch (error) {
    dbxSetError("network", error && error.message);
    return false;
  }
}

async function dbxDownloadArchive() {
  if (!dbxConnected()) return { status: "error" };
  const arg = JSON.stringify({ path: DBX_ARCHIVE_PATH });
  const download = (token) =>
    fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": arg },
    });
  try {
    let token = localStorage.getItem(DBX_TOKEN_KEY);
    let res = token ? await download(token) : null;
    if (!res || res.status === 401) {
      token = await dbxRefreshToken();
      if (token) res = await download(token);
    }
    if (res && res.status === 409) return { status: "empty" }; // 아직 백업 파일 없음
    if (res && res.ok) {
      try {
        const list = JSON.parse(await res.text());
        return { status: "ok", list: Array.isArray(list) ? list : [] };
      } catch {
        dbxSetError("parse", "");
        return { status: "error" };
      }
    }
    dbxSetError(res ? res.status : 401, res ? await res.text().catch(() => "") : "");
    return { status: "error" };
  } catch (error) {
    dbxSetError("network", error && error.message);
    return { status: "error" };
  }
}

function dbxMergeArchives(localList, remoteList) {
  const byId = new Map();
  for (const item of remoteList) if (item && item.id) byId.set(item.id, item);
  for (const item of localList) {
    if (!item || !item.id) continue;
    const existing = byId.get(item.id);
    const localTime = new Date(item.savedAt || 0).getTime();
    const remoteTime = existing ? new Date(existing.savedAt || 0).getTime() : -1;
    if (!existing || localTime >= remoteTime) byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime(),
  );
}

function dbxMarkSynced() {
  localStorage.setItem(DBX_LASTSYNC_KEY, new Date().toISOString());
}

// 다운로드→병합→업로드 (수동 '지금 동기화' + 계약 완료 시 자동)
async function dbxSyncNow() {
  if (!dbxConnected()) return false;
  const remote = await dbxDownloadArchive();
  if (remote.status === "error") return false;
  if (remote.status === "ok") {
    saveArchiveList(dbxMergeArchives(loadArchive(), remote.list));
  }
  const ok = await dbxPushArchive();
  if (ok) dbxMarkSynced();
  return ok;
}

// 앱 시작 시: 다운로드→병합만 (로컬을 덮어쓸 위험 없이 원격 항목을 가져옴)
async function dbxInitSync() {
  if (!dbxConnected()) return;
  const remote = await dbxDownloadArchive();
  if (remote.status === "ok") {
    saveArchiveList(dbxMergeArchives(loadArchive(), remote.list));
    dbxMarkSynced();
    if (elements.archive && !elements.archive.hidden) renderArchiveList();
  }
  renderDbxPanel();
  // 초안도 원격에서 가져오기(다른 기기에서 이어가기)
  dbxPullDraftIfNewer().catch(() => {});
}

// 계약 완료(추가) 시 자동: 원격과 병합 후 업로드
function dbxAutoSync() {
  if (!dbxConnected()) return;
  dbxSyncNow()
    .then(() => renderDbxPanel())
    .catch(() => {});
}

// 삭제 시 자동: 병합 없이 로컬을 그대로 업로드해 원격에서도 삭제되게 함
function dbxAutoPush() {
  if (!dbxConnected()) return;
  dbxPushArchive()
    .then((ok) => {
      if (ok) {
        dbxMarkSynced();
        renderDbxPanel();
      }
    })
    .catch(() => {});
}

function dbxDisconnect() {
  if (!confirm("Dropbox 연결을 해제할까요? 이 기기의 보관함 내용은 그대로 남습니다.")) return;
  [DBX_REFRESH_KEY, DBX_TOKEN_KEY, DBX_ACCOUNT_KEY, DBX_LASTSYNC_KEY, DBX_VERIFIER_KEY].forEach((key) =>
    localStorage.removeItem(key),
  );
  renderDbxPanel();
}

async function runDbxSync(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "동기화 중…";
  dbxLastError = "";
  try {
    const ok = await dbxSyncNow();
    if (!ok) alert(dbxLastError || "Dropbox 동기화에 실패했습니다. 연결 상태와 인터넷을 확인해 주세요.");
  } finally {
    button.disabled = false;
    button.textContent = original;
    renderArchiveList();
    renderDbxPanel();
  }
}

function renderDbxPanel() {
  const panel = elements.dbxPanel;
  if (!panel) return;
  if (dbxConnected()) {
    const account = dbxAccountLabel();
    const last = localStorage.getItem(DBX_LASTSYNC_KEY);
    panel.innerHTML = `
      <div class="dbx-connected">
        <div class="dbx-status">
          <strong>Dropbox 연결됨</strong>
          ${account ? `<span>${escapeHtml(account)}</span>` : ""}
          <span class="dbx-sync-time">${
            last ? `마지막 동기화 ${escapeHtml(formatKoreanDateTime(last))}` : "아직 동기화되지 않음"
          }</span>
        </div>
        <div class="dbx-actions">
          <button class="secondary-button small" type="button" data-action="dbx-sync">지금 동기화</button>
          <button class="danger-button small" type="button" data-action="dbx-disconnect">연결 해제</button>
        </div>
      </div>`;
  } else {
    const appKey = escapeHtml(localStorage.getItem(DBX_APPKEY_KEY) || "");
    const redirectUri = escapeHtml(dbxRedirectUri());
    panel.innerHTML = `
      <div class="dbx-connect">
        <strong>Dropbox에 백업</strong>
        <p class="field-help">보관함을 Dropbox에 백업하면 기기를 바꾸거나 브라우저 데이터를 지워도 계약이 남습니다. 계약을 완료할 때마다 자동으로 올라갑니다.</p>
        <div class="dbx-connect-row">
          <input class="dbx-input" id="dbxAppKey" type="text" inputmode="latin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Dropbox App Key" value="${appKey}" />
          <button class="primary-button small" type="button" data-action="dbx-connect">연결하기</button>
        </div>
        <details class="dbx-guide">
          <summary>App Key 만드는 방법</summary>
          <ol>
            <li>Dropbox 개발자 콘솔(dropbox.com/developers/apps)에서 <b>Create app</b></li>
            <li>Scoped access → <b>App folder</b> 선택 후 앱 이름 입력</li>
            <li>Permissions 탭에서 <b>files.content.write</b>, <b>files.content.read</b> 체크 → Submit</li>
            <li>Settings 탭 → OAuth 2 → Redirect URIs에 이 주소 추가:<br><code>${redirectUri}</code></li>
            <li>같은 화면의 <b>App key</b>를 복사해 위 칸에 붙여넣고 연결하기</li>
          </ol>
        </details>
      </div>`;
  }
}

async function initDropbox() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code) {
    await dbxCompleteAuth(code);
    // 인증 코드가 붙은 URL을 깨끗하게 정리
    history.replaceState(null, "", dbxRedirectUri());
  }
  renderDbxPanel();
  dbxInitSync();
}

/* ── 이미지·PDF 내보내기 ── */

async function runExport(button, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "만드는 중…";
  try {
    await task();
  } catch (error) {
    alert(`저장에 실패했습니다: ${error && error.message ? error.message : error}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function renderContractCanvas(scale = 2, pageHeightCss = 0) {
  updateDocuments();
  const width = 760;

  const styleElement = document.createElement("style");
  styleElement.textContent = DOC_CSS;

  const holder = document.createElement("div");
  holder.className = "contract-doc";
  holder.style.cssText = `width:${width}px;padding:28px;box-sizing:border-box;background:#fff;`;
  holder.innerHTML = elements.printDocument.innerHTML;
  holder.prepend(styleElement);

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-99999px;top:0;";
  probe.append(holder);
  document.body.append(probe);

  // data URL 이미지도 비동기로 로드되므로, 크기 측정 전에 로드 완료를 기다린다.
  await Promise.all(
    Array.from(holder.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          }),
    ),
  );

  // PDF용: 조항 블록이 페이지 경계에 걸리면 다음 페이지로 밀어내는 여백 삽입.
  // DOM 측정과 SVG 렌더 사이에 줄높이 반올림 차이가 누적될 수 있어 안전 마진을 둔다.
  if (pageHeightCss > 0) {
    const SAFETY = 40;
    const blocks = Array.from(holder.children).filter((el) => el.tagName !== "STYLE");
    for (const block of blocks) {
      const holderTop = holder.getBoundingClientRect().top;
      const rect = block.getBoundingClientRect();
      const top = rect.top - holderTop;
      const bottom = top + rect.height;
      const startPage = Math.floor(top / pageHeightCss);
      const endPage = Math.floor((bottom - 1 + SAFETY) / pageHeightCss);
      if (endPage > startPage && rect.height <= pageHeightCss - SAFETY - 16) {
        const spacer = document.createElement("div");
        spacer.style.height = `${(startPage + 1) * pageHeightCss - top + 16}px`;
        block.before(spacer);
      }
    }
  }

  // SVG-이미지 컨텍스트에서는 중첩 <img>(서명·별첨)가 로드되지 않는다.
  // 각 이미지를 같은 크기의 색상 마커 플레이스홀더로 치환하고,
  // 렌더링된 캔버스에서 마커 픽셀을 찾아 그 위치에 실제 이미지를 합성한다.
  // (DOM 측정 좌표는 SVG 렌더와 어긋날 수 있으므로 사용하지 않는다.)
  const embeddedImages = [];
  Array.from(holder.querySelectorAll("img")).forEach((img, index) => {
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      img.remove();
      return;
    }
    const computed = getComputedStyle(img);
    const placeholder = document.createElement("div");
    placeholder.style.cssText =
      `display:block;box-sizing:border-box;width:${rect.width}px;height:${rect.height}px;` +
      `margin:${computed.margin};border:${computed.border};border-radius:${computed.borderRadius};`;
    placeholder.style.borderBottom = computed.borderBottom;
    // border-radius가 마커를 깎지 않도록 좌상단 모서리에서 12px 안쪽에 배치
    placeholder.style.background = `linear-gradient(rgb(255,${index},254),rgb(255,${index},254)) 12px 0/10px 10px no-repeat #fff`;
    embeddedImages.push({ src: img.getAttribute("src") || "", w: rect.width, h: rect.height, index });
    img.replaceWith(placeholder);
  });

  const holderRect = holder.getBoundingClientRect();
  const height = Math.ceil(holderRect.height);
  const serialized = new XMLSerializer().serializeToString(holder);
  probe.remove();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;

  // blob: URL은 Chromium에서 캔버스를 오염시키므로 data: URL 사용
  const baseImage = await loadImageFromSrc(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    "계약서 이미지를 렌더링하지 못했습니다.",
  );

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

  if (embeddedImages.length) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const canvasWidth = canvas.width;
    const markers = new Map();
    for (let y = 0; y < canvas.height && markers.size < embeddedImages.length; y += 1) {
      for (let x = 0; x < canvasWidth; x += 1) {
        const i = (y * canvasWidth + x) * 4;
        if (pixels[i] === 255 && pixels[i + 2] === 254 && !markers.has(pixels[i + 1])) {
          // 마커 내부 픽셀 재확인 (안티앨리어싱 가장자리 오탐 방지)
          const inner = ((y + 4) * canvasWidth + (x + 4)) * 4;
          if (pixels[inner] === 255 && pixels[inner + 2] === 254 && pixels[inner + 1] === pixels[i + 1]) {
            markers.set(pixels[i + 1], { x, y });
          }
        }
      }
    }

    for (const item of embeddedImages) {
      const marker = markers.get(item.index);
      if (!marker || !item.src) continue;
      try {
        const image = await loadImageFromSrc(item.src, "첨부 이미지를 불러오지 못했습니다.");
        const boxX = marker.x - 12 * scale;
        const boxY = marker.y;
        const boxWidth = item.w * scale;
        const boxHeight = item.h * scale;
        context.fillStyle = "#fff";
        context.fillRect(marker.x - 2, marker.y - 2, 14 * scale, 14 * scale);
        const ratio = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
        const drawWidth = image.naturalWidth * ratio;
        const drawHeight = image.naturalHeight * ratio;
        const dx = boxX + (boxWidth - drawWidth) / 2;
        const dy = boxY + (boxHeight - drawHeight) / 2;
        context.drawImage(image, dx, dy, drawWidth, drawHeight);
      } catch {
        // 개별 이미지 실패는 건너뛰고 본문은 유지
      }
    }
  }

  return canvas;
}

function loadImageFromSrc(src, errorMessage) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorMessage));
    image.src = src;
  });
}

async function downloadContractImage() {
  const canvas = await renderContractCanvas(2);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG 생성에 실패했습니다.");
  await shareOrDownloadBlob(blob, `차용증-${state.completed.contractNumber || "draft"}.png`);
}

async function downloadContractPdf() {
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const MARGIN = 28;
  const SCALE = 2;
  // 슬라이스 픽셀 경계와 정확히 일치하는 페이지 높이(CSS px) 계산
  const contentWidthPtRaw = A4_WIDTH - MARGIN * 2;
  const contentHeightPtRaw = A4_HEIGHT - MARGIN * 2;
  const pxPerPt = (760 * SCALE) / contentWidthPtRaw;
  const pageHeightPx = Math.floor(contentHeightPtRaw * pxPerPt);
  const canvas = await renderContractCanvas(SCALE, pageHeightPx / SCALE);
  const { slices, contentWidthPt } = canvasToPageSlices(canvas, A4_WIDTH, A4_HEIGHT, MARGIN);
  const bytes = buildPdf(slices, A4_WIDTH, A4_HEIGHT, MARGIN, contentWidthPt);
  await shareOrDownloadBlob(new Blob([bytes], { type: "application/pdf" }), `차용증-${state.completed.contractNumber || "draft"}.pdf`);
}

function canvasToPageSlices(canvas, pageWidthPt, pageHeightPt, marginPt) {
  const contentWidthPt = pageWidthPt - marginPt * 2;
  const contentHeightPt = pageHeightPt - marginPt * 2;
  const pxPerPt = canvas.width / contentWidthPt;
  const pageHeightPx = Math.floor(contentHeightPt * pxPerPt);
  const slices = [];

  for (let y = 0; y < canvas.height; y += pageHeightPx) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - y);
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = sliceHeightPx;
    const context = page.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, page.width, page.height);
    context.drawImage(canvas, 0, y, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
    slices.push({
      jpegBytes: dataUrlToBytes(page.toDataURL("image/jpeg", 0.85)),
      widthPx: page.width,
      heightPx: sliceHeightPx,
      heightPt: sliceHeightPx / pxPerPt,
    });
  }

  return { slices, contentWidthPt };
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildPdf(slices, pageWidthPt, pageHeightPt, marginPt, contentWidthPt) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const pushText = (text) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const beginObject = (num) => {
    offsets[num] = offset;
    pushText(`${num} 0 obj\n`);
  };

  const pageObjectNums = slices.map((_, index) => 3 + index * 3);
  const totalObjects = 2 + slices.length * 3;

  pushText("%PDF-1.4\n");

  beginObject(1);
  pushText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  beginObject(2);
  pushText(`<< /Type /Pages /Kids [${pageObjectNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${slices.length} >>\nendobj\n`);

  slices.forEach((slice, index) => {
    const pageNum = pageObjectNums[index];
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const drawHeightPt = slice.heightPt;
    const yPt = pageHeightPt - marginPt - drawHeightPt;

    beginObject(pageNum);
    pushText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] ` +
        `/Resources << /XObject << /Im${index} ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    const contentStream = `q ${contentWidthPt.toFixed(2)} 0 0 ${drawHeightPt.toFixed(2)} ${marginPt.toFixed(2)} ${yPt.toFixed(2)} cm /Im${index} Do Q`;
    beginObject(contentNum);
    pushText(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`);

    beginObject(imageNum);
    pushText(
      `<< /Type /XObject /Subtype /Image /Width ${slice.widthPx} /Height ${slice.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${slice.jpegBytes.length} >>\nstream\n`,
    );
    pushBytes(slice.jpegBytes);
    pushText("\nendstream\nendobj\n");
  });

  const xrefOffset = offset;
  pushText(`xref\n0 ${totalObjects + 1}\n`);
  pushText("0000000000 65535 f \n");
  for (let num = 1; num <= totalObjects; num += 1) {
    pushText(`${String(offsets[num]).padStart(10, "0")} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

async function shareOrDownloadBlob(blob, filename) {
  const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
  if (isTouchDevice && navigator.canShare && typeof File === "function") {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        // 파일만 공유 — title/text를 넣지 않아야 메시지 앱에서 문자 없이 이미지만 전송된다
        await navigator.share({ files: [file] });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
        // 공유 실패 시 파일 다운로드로 대체
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function fullAddress(base, detail) {
  return [base, detail]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function buildContractHtml() {
  const data = state.data;
  const amount = data.principalNumber || 0;
  const creditor = data.creditorName || "채권자";
  const debtor = data.debtorName || "채무자";
  const hasGuarantor = data.guarantorType === "guarantor";
  const hasInterest = data.interestType === "interest";
  const interestText = hasInterest
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

  const partyDataCols = hasGuarantor ? 3 : 2;
  const partyDataColWidth = ((100 - 16) / partyDataCols).toFixed(2);
  const partyColgroup =
    `<colgroup><col style="width:16%" />` +
    `<col style="width:${partyDataColWidth}%" />`.repeat(partyDataCols) +
    `</colgroup>`;

  const partyTable = `
    <table class="party-table">
      ${partyColgroup}
      <tbody>
        <tr><th>구분</th><th>채권자</th><th>채무자</th>${hasGuarantor ? "<th>연대보증인</th>" : ""}</tr>
        ${partyRow("이름", data.creditorName, data.debtorName, data.guarantorName)}
        ${partyRow("주민등록번호", data.creditorRRN || "미기재", data.debtorRRN || "미기재", data.guarantorRRN || "미기재")}
        ${partyRow("휴대전화번호", data.creditorPhone, data.debtorPhone, data.guarantorPhone)}
        ${partyRow("주소", fullAddress(data.creditorAddress, data.creditorAddressDetail), fullAddress(data.debtorAddress, data.debtorAddressDetail), fullAddress(data.guarantorAddress, data.guarantorAddressDetail))}
        ${partyRow("이메일", data.creditorEmail || "미기재", data.debtorEmail || "미기재", hasGuarantor ? "미기재" : "")}
      </tbody>
    </table>
  `;

  const clauses = [];

  clauses.push(["당사자", partyTable]);

  clauses.push(["대여금", renderLoanClause(data, amount)]);

  clauses.push(["이자", renderInterestClause(data)]);
  clauses.push(["상환 방법", renderRepaymentClause(data)]);

  clauses.push([
    "지연손해금",
    `<p>채무자가 제4조의 상환기한 또는 제6조에 따른 조기상환기한까지 원금을 전부 상환하지 않은 경우, 각 기한의 다음 날부터 실제 상환일까지 미상환 원금에 대하여 <strong>${escapeHtml(renderLateRate(data))}</strong>와 관계 법령상 최고이율 중 낮은 이율로 지연손해금을 일할 계산하여 지급합니다.</p>
     <p>지연손해금은 미상환 원금을 기준으로 하며, 이미 발생한 지연손해금에는 다시 이자를 붙이지 않습니다.</p>`,
  ]);

  clauses.push(["기한의 이익 상실 및 조기상환 청구", renderAccelerationClause(data)]);

  clauses.push([
    "조기상환과 완납 확인",
    `<p>채무자는 상환기한 전이라도 원금의 전부 또는 일부를 미리 상환할 수 있으며, 중도상환수수료는 없습니다.${
      hasInterest ? " 이후의 이자는 미상환 원금을 기준으로 계산합니다." : ""
    }</p>
     <p>채무자가 상환기한 전에 원금 일부를 상환한 경우, 미상환 원금은 실제 상환한 금액만큼 줄어듭니다. 상환기한이 지난 후 일부 금액을 지급한 경우에는 관계 법령상 인정되는 변제비용, 지연손해금, 원금의 순서로 충당하며, 원금에 충당된 금액만큼 미상환 원금이 줄어듭니다. 지연손해금은 남은 미상환 원금을 기준으로 계산합니다.</p>
     <p>채무자가 원금, 발생한 지연손해금 및 관계 법령상 부담하는 변제비용을 모두 지급하면 채권자는 완납확인서 또는 영수증을 발급해야 하며, 양쪽은 계좌이체 확인증과 상환 확인 기록을 보관합니다.</p>`,
  ]);

  if (hasGuarantor) {
    clauses.push(["연대보증", renderGuarantorClause(data)]);
  }

  clauses.push([
    "연락처 또는 주소 변경",
    `<p>계약 당사자는 휴대전화번호, 주소 또는 이메일이 변경된 경우 변경일로부터 7일 이내에 상대방에게 문자, 이메일, 카카오톡 또는 서면으로 알려야 합니다. 통지한 당사자는 발송기록 또는 수신기록을 보관합니다.</p>`,
  ]);

  clauses.push([
    "계약 변경",
    `<p>이 계약의 내용을 변경하거나 추가하려면 변경 내용을 기재한 서면 또는 전자문서에 채권자와 채무자가 각각 서명해야 합니다. 이 절차를 거치지 않은 전화, 대화 또는 구두 합의는 계약 변경으로서 효력이 없습니다.</p>`,
  ]);

  clauses.push([
    "전자문서와 전자서명",
    `<p>계약 당사자는 이 계약서를 모바일 또는 전자문서로 작성하고 전자서명하는 것에 동의합니다. 각 당사자는 전자서명 전에 계약서 전체 내용을 확인하였으며, 서명 후 동일한 내용의 최종 계약서를 각각 보관합니다.</p>
     <p>이 계약서는 공정증서가 아니며, 이 문서만으로 곧바로 강제집행을 할 수 있다는 뜻으로 해석하지 않습니다.</p>`,
  ]);

  clauses.push([
    "관할법원과 분쟁 해결",
    `<p>당사자는 분쟁이 발생한 경우 먼저 대화와 서면 협의를 통해 해결하도록 노력합니다.</p>
     <p>협의로 해결되지 않는 경우에는 ${
       data.court ? `${escapeHtml(data.court)}을(를)` : "이 계약 체결 당시 채권자의 주소지를 관할하는 법원을"
     } 제1심 관할법원으로 합니다.</p>`,
  ]);

  if (data.specialTerms) {
    clauses.push(["특약사항(추가 약속)", `<p>${escapeHtml(data.specialTerms)}</p>`]);
  }

  const clausesHtml = clauses
    .map(([title, body], index) => `<section class="clause"><h2>제${index + 1}조 ${escapeHtml(title)}</h2>${body}</section>`)
    .join("");

  return `
    <h1>금전소비대차계약서</h1>
    <div class="contract-meta">
      <p><strong>계약번호</strong><br>${escapeHtml(state.completed.contractNumber || "계약 완료 시 자동 생성")}</p>
      <p><strong>작성일</strong><br>${escapeHtml(formatDateKorean(data.loanDate || todayInput()))}</p>
      <p><strong>문서 확인값</strong><br>${escapeHtml(state.completed.documentHash || "계약 완료 시 SHA-256 생성")}</p>
      <p><strong>완료 시각</strong><br>${escapeHtml(state.completed.completedAt ? formatKoreanDateTime(state.completed.completedAt) : "계약 완료 전")}</p>
    </div>

    <section class="clause">
      <h2>쉬운 말 요약</h2>
      <p>${escapeHtml(creditor)} 님은 ${escapeHtml(debtor)} 님에게 <strong>${escapeHtml(formatWon(amount))}원</strong>을 빌려줍니다.</p>
      <p>대여금은 <strong>${escapeHtml(numberToKoreanMoney(amount))}</strong>으로 표시하며, ${escapeHtml(repaymentText)}</p>
      <p>${escapeHtml(interestText)} 상환금은 ${escapeHtml(data.repaymentBank || "-")} ${escapeHtml(data.repaymentAccount || "-")} 계좌로 보냅니다.</p>
      ${guarantorSummary}
      <p class="summary-note">※ 쉬운 말 요약은 계약 내용을 쉽게 이해할 수 있도록 정리한 참고사항입니다. 요약 내용과 계약 본문이 다를 경우에는 계약 본문을 따릅니다.</p>
    </section>

    ${clausesHtml}

    <section class="clause">
      <h2>계약 체결 확인</h2>
      <p>계약 당사자는 위 계약 내용을 모두 확인하고 각각 서명합니다.</p>
      <div class="signature-print-grid">
        ${renderSignatureBlock("채권자", data.creditorName, state.signatures.creditor)}
        ${renderSignatureBlock("채무자", data.debtorName, state.signatures.debtor)}
        ${hasGuarantor ? renderSignatureBlock("연대보증인", data.guarantorName, state.signatures.guarantor) : ""}
      </div>
    </section>
    ${renderAuditSection()}
    ${renderAttachmentSection()}
  `;
}

function renderAuditSection() {
  if (!state.includeAudit) return "";
  if (!state.audit.length && !state.completed.completedAt) return "";

  const rows = state.audit
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(formatKoreanDateTime(entry.at))}</td></tr>`,
    )
    .join("");

  const tz = state.completed.timeZone || "기기 지역";
  const device = state.completed.userAgent
    ? `<p class="audit-device">작성 기기 정보: ${escapeHtml(state.completed.userAgent)}</p>`
    : "";

  return `
    <section class="clause">
      <h2>전자서명 진행 기록</h2>
      <p>이 계약을 작성·확인·서명한 진행 시각입니다. (시간대: ${escapeHtml(tz)})</p>
      ${rows ? `<table><thead><tr><th>기록</th><th>시각</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
      <p>문서 확인값(SHA-256)은 위 계약 내용과 당사자 서명, 별첨 자료, 이 진행 기록을 모두 포함해 계산한 값입니다. 계약서의 글자·서명·첨부 중 하나라도 바뀌면 확인값이 달라지므로, 계약이 완료된 이후 문서가 변경되지 않았음을 확인하는 자료로 사용할 수 있습니다.</p>
      ${device}
    </section>
  `;
}

function renderAttachmentSection() {
  if (!state.attachments.length) return "";
  const figures = state.attachments
    .map(
      (attachment, index) => `
        <section class="clause">
          <figure class="attachment-print">
            <img src="${attachment.dataUrl}" alt="별첨 ${index + 1}">
            <figcaption>별첨 ${index + 1} · ${escapeHtml(attachment.name)}</figcaption>
          </figure>
        </section>
      `,
    )
    .join("");
  return `<section class="clause"><h2>별첨</h2><p>다음 자료를 계약 체결 또는 대여금 지급 사실을 확인하기 위한 별첨자료로 첨부합니다. 각 별첨자료의 제목과 첨부 목적은 아래에 표시합니다.</p><p>별도의 명시가 없는 한 별첨자료의 첨부만으로 담보 제공, 소유권 이전 또는 보증 약정이 성립하는 것은 아닙니다.</p></section>${figures}`;
}

function renderAccelerationClause(data) {
  const isInstallment = data.repaymentType === "installment";
  const hasInterest = data.interestType === "interest";
  const reasons = [];
  // 정기적으로 갚아야 할 분할금·이자가 있는 계약에서만 '연속 지체' 사유가 의미가 있음
  if (isInstallment) reasons.push("채무자가 분할상환금을 2회 연속 지체한 경우");
  if (hasInterest) reasons.push("채무자가 이자를 2회 연속 지체한 경우");
  reasons.push(
    "채무자의 주요 재산에 대하여 가압류·압류 또는 강제집행 절차가 개시되거나, 채무자에 대하여 파산·회생 또는 개인회생 절차가 개시된 경우",
  );
  reasons.push(
    "채무자가 재산을 은닉하거나 정당한 이유 없이 처분하는 등 채권 회수가 현저히 곤란해질 우려가 있는 경우",
  );
  reasons.push(
    "채무자가 연락처 또는 주소의 변경 사실을 알리지 않아, 채권자가 기존 연락처 또는 주소로 7일 이상의 간격을 두고 2회 이상 연락하였음에도 연락되지 않는 경우",
  );

  const items = reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  return `
    <p>채무자에게 다음 사유가 발생한 경우, 채권자는 채무자에게 서면 또는 전자문서로 통지하고 미상환 원금 전액의 조기상환을 청구할 수 있습니다.</p>
    <ol>${items}</ol>
    <p>채권자는 조기상환을 청구할 때 조기상환 사유, 미상환 원금 및 조기상환기한을 구체적으로 알려야 하며, 조기상환기한은 통지일로부터 7일 이후의 날로 정합니다. 채무자가 조기상환기한까지 미상환 원금을 지급하지 않으면 그 조기상환기한이 도래한 때 기한의 이익을 상실하고, 그 다음 날부터 제5조의 지연손해금이 발생합니다.</p>
  `;
}

function renderGuarantorClause(data) {
  const obligation = data.interestType === "interest" ? "원금, 이자 및 지연손해금" : "원금 및 지연손해금";
  return `
    <p>연대보증인 ${escapeHtml(data.guarantorName || "-")}은(는) 이 계약에 따라 채무자가 부담하는 ${obligation} 지급채무를 채무자와 연대하여 보증합니다.</p>
    <p>연대보증인은 이 계약서의 내용을 모두 확인하였으며, 「민법」 제428조의2에 따라 보증 의사를 표시하기 위하여 이 서면에 직접 서명합니다.</p>
  `;
}

function renderLoanClause(data, amount) {
  const money = `<strong>${escapeHtml(numberToKoreanMoney(amount))}(${escapeHtml(formatWon(amount))}원)</strong>`;
  const date = `<strong>${escapeHtml(formatDateKorean(data.loanDate))}</strong>`;
  const method = `<strong>${escapeHtml(data.paymentMethod || "계좌이체")}</strong>`;

  const payLine =
    data.paymentStatus === "pending"
      ? `<p>채권자는 채무자에게 대여 원금 ${money}을 ${date} ${method} 방식으로 채무자 명의의 수령계좌 또는 채무자가 서면이나 전자문서로 지정한 계좌에 지급하기로 합니다.</p>`
      : `<p>채권자는 채무자에게 대여 원금 ${money}을 ${date} ${method} 방식으로 채무자 명의의 수령계좌 또는 채무자가 서면이나 전자문서로 지정한 계좌에 지급하였으며, 채무자는 이를 수령하였음을 확인합니다.</p>`;

  return `
    ${payLine}
    <p>채무자가 제3자 명의의 계좌를 지정한 경우, 해당 계좌에 대여금이 입금된 때 채무자가 대여금을 지급받은 것으로 봅니다.</p>
    <p>이 계약은 양 당사자의 서명이 완료된 때 성립하며, 채무자의 원금 상환 의무는 대여금이 실제로 입금된 때부터 실제 입금된 금액의 범위에서 발생합니다. 실제 입금액이 위 계약금액과 다른 경우에는 별도의 서면 합의가 없는 한 실제 입금액을 대여 원금으로 하되, 대여 원금은 위 계약금액을 초과하지 않습니다.</p>
    <p>계좌이체 확인증, 이체 내역 등 대여금 지급을 확인할 수 있는 자료는 대여 사실을 증명하는 자료로 사용하며, 양쪽이 보관합니다.</p>
  `;
}

function renderInterestClause(data) {
  if (data.interestType !== "interest") {
    return `<p>이 대여금에는 약정이자를 부과하지 않습니다. 다만, 채무자가 상환기한을 넘긴 경우에는 제5조의 지연손해금이 발생합니다.</p>`;
  }

  return `
    <p>채무자는 원금에 대해 <strong>연 ${escapeHtml(formatRate(data.interestRateNumber))}%</strong>의 이자를 지급합니다. 이자는 실제로 돈을 받은 날의 다음 날부터 원금을 모두 갚는 날까지 계산합니다.</p>
    <p>이자 지급 방법은 <strong>${escapeHtml(data.interestPayment || "원금 상환일에 함께 지급")}</strong>으로 합니다. 약정이자와 돈을 빌려주는 대가로 받는 수수료 등의 합계가 법에서 정한 최고이자율을 초과하는 경우에는 법정 최고이자율까지만 적용합니다.</p>
  `;
}

function renderRepaymentClause(data) {
  const accountText =
    `상환계좌는 금융기관 : <strong>${escapeHtml(data.repaymentBank || "-")}</strong>` +
    ` / 계좌번호 : <strong>${escapeHtml(data.repaymentAccount || "-")}</strong>` +
    ` / 예금주 : <strong>${escapeHtml(data.repaymentHolder || "-")}</strong> 입니다.`;

  const accountChangeNote =
    "<p>상환계좌를 변경하려면 채권자가 서명한 서면 또는 전자문서로 채무자에게 알려야 하며, 이 절차에 따르지 않은 상환계좌 변경 통지는 효력이 없습니다.</p>";

  const hasInterest = data.interestType === "interest";
  const holidayNote =
    "<p>상환기한이 토요일·일요일 또는 공휴일인 경우에는 그 다음 영업일까지 갚습니다.</p>";
  const noInterestNote = hasInterest
    ? ""
    : "<p>이 계약에 따른 약정이자는 없으며, 채무자가 상환기한을 넘긴 경우에만 지연손해금이 발생합니다.</p>";

  if (data.repaymentType === "installment") {
    const principalText = hasInterest ? "원금과 이자를" : "원금을";
    return `
      <p>채무자는 아래 일정에 따라 ${principalText} <strong>${escapeHtml(String(data.installmentCountNumber))}회</strong>에 걸쳐 나누어 갚습니다. 원 단위 차이는 마지막 회차에서 정리합니다.</p>
      ${renderScheduleTable(data.repaymentSchedule)}
      <p>${accountText}</p>
      ${accountChangeNote}
      ${holidayNote}
      ${noInterestNote}
    `;
  }

  const lumpText = hasInterest
    ? `<p>채무자는 <strong>${escapeHtml(formatDateKorean(data.finalDueDate))}</strong>까지 원금 전액과 그때까지 발생한 이자를 아래 상환계좌로 일시 상환합니다.</p>`
    : `<p>채무자는 <strong>${escapeHtml(formatDateKorean(data.finalDueDate))}</strong>까지 원금 전액을 아래 상환계좌로 일시 상환합니다.</p>`;

  return `
    ${lumpText}
    <p>${accountText}</p>
    ${accountChangeNote}
    <p>상환은 위 상환계좌에 상환금이 실제로 입금된 때 완료된 것으로 봅니다.</p>
    ${holidayNote}
    ${noInterestNote}
  `;
}

function renderLateRate(data) {
  if (!data.lateRate && data.lateRate !== "0") return "관계 법령상 최고이율";
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

const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

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
      resizeSignatureCanvas(type);
    },
  };

  signaturePads.set(type, pad);
  pad.resize();

  // 모바일(터치): 서명란을 탭하면 전체화면 가로 서명창을 연다 (스크롤 방지 + 넓은 서명 공간)
  if (isCoarsePointer) {
    canvas.classList.add("tap-to-sign");
    canvas.addEventListener("click", () => openSignModal(type));
    return;
  }

  // 데스크탑(마우스): 서명란에 직접 그린다
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // 일부 환경에서 포인터 캡처가 거부되어도 서명은 계속 진행
    }
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
    logSignatureEvent(type);
    updateSignatureTimes();
    scheduleSave();
  };

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", finish);
}

/* ── 전체화면 가로 서명 모달 (모바일) ── */

let signModalType = null;
let signModalPad = null;

function openSignModal(type) {
  signModalType = type;
  const roleLabel = { creditor: "채권자", debtor: "채무자", guarantor: "연대보증인" }[type] || "";
  elements.signModalTitle.textContent = `${roleLabel} 서명`;
  elements.signModal.hidden = false;
  document.body.style.overflow = "hidden";
  // 레이아웃이 반영된 뒤 캔버스 크기를 잡는다
  requestAnimationFrame(() => setupSignModalPad());
}

function closeSignModal() {
  elements.signModal.hidden = true;
  document.body.style.overflow = "";
  signModalType = null;
  signModalPad = null;
}

function setupSignModalPad() {
  const canvas = elements.signModalCanvas;
  const stage = elements.signModalStage;
  const stageRect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const portrait = window.innerHeight >= window.innerWidth;

  // 세로 화면에서는 캔버스를 90° 돌려 가로로 넓게 서명하도록 한다
  const pad = 10;
  let cssW;
  let cssH;
  if (portrait) {
    cssW = Math.max(1, Math.round(stageRect.height - pad * 2));
    cssH = Math.max(1, Math.round(stageRect.width - pad * 2));
    canvas.style.transform = "rotate(90deg)";
  } else {
    cssW = Math.max(1, Math.round(stageRect.width - pad * 2));
    cssH = Math.max(1, Math.round(stageRect.height - pad * 2));
    canvas.style.transform = "none";
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = "#101040";

  const drawGuide = () => {
    ctx.save();
    ctx.strokeStyle = "rgba(35, 68, 59, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cssW * 0.06, cssH * 0.72);
    ctx.lineTo(cssW * 0.94, cssH * 0.72);
    ctx.stroke();
    ctx.restore();
  };
  drawGuide();

  let drawing = false;
  let lastPoint = null;
  let hasInk = false;

  const toLocal = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const style = getComputedStyle(canvas);
    const matrix = new DOMMatrix(style.transform === "none" ? "" : style.transform);
    const point = matrix.inverse().transformPoint(new DOMPoint(clientX - cx, clientY - cy));
    return { x: point.x + canvas.offsetWidth / 2, y: point.y + canvas.offsetHeight / 2 };
  };

  ["touchstart", "touchmove", "touchend"].forEach((eventType) => {
    canvas.addEventListener(eventType, (event) => event.preventDefault(), { passive: false });
  });

  canvas.onpointerdown = (event) => {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* 캡처 거부되어도 계속 진행 */
    }
    drawing = true;
    lastPoint = toLocal(event.clientX, event.clientY);
    // 점 하나만 찍어도 획으로 인식되도록 시작점을 찍는다
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(lastPoint.x + 0.1, lastPoint.y + 0.1);
    ctx.stroke();
    hasInk = true;
  };
  canvas.onpointermove = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = toLocal(event.clientX, event.clientY);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint = point;
    hasInk = true;
  };
  const stop = (event) => {
    if (!drawing) return;
    event.preventDefault();
    drawing = false;
    lastPoint = null;
  };
  canvas.onpointerup = stop;
  canvas.onpointercancel = stop;

  signModalPad = {
    canvas,
    isBlank: () => !hasInk,
    clear: () => {
      ctx.clearRect(0, 0, cssW, cssH);
      drawGuide();
      hasInk = false;
    },
  };
}

function confirmSignModal() {
  if (!signModalPad || signModalPad.isBlank()) {
    alert("서명을 입력한 뒤 [확인]을 눌러 주세요.");
    return;
  }
  const type = signModalType;
  state.signatures[type] = {
    dataUrl: signModalPad.canvas.toDataURL("image/png"),
    signedAt: new Date().toISOString(),
  };
  logSignatureEvent(type);
  closeSignModal();
  signaturePads.get(type)?.resize();
  updateSignatureTimes();
  scheduleSave();
}

function resizeAllSignatures() {
  signaturePads.forEach((pad) => pad.resize());
}

function resizeSignatureCanvas(type) {
  const pad = signaturePads.get(type);
  if (!pad) return;
  const { canvas, context } = pad;
  const rect = canvas.getBoundingClientRect();
  // 숨겨진 캔버스(크기 0)를 리사이즈하면 저장된 서명이 빈 이미지로 손상되므로 건너뛴다
  if (rect.width < 2 || rect.height < 2) return;

  const dataUrl = state.signatures[type].dataUrl;
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
    };
    image.src = dataUrl;
  } else if (isCoarsePointer) {
    // 모바일: 서명 전에는 '탭하여 서명' 안내를 표시
    context.save();
    context.fillStyle = "rgba(60, 60, 67, 0.45)";
    context.font = "600 14px -apple-system, 'Apple SD Gothic Neo', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("탭하여 서명", rect.width / 2, rect.height * 0.44);
    context.restore();
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
  updateSaveBadge();
  scheduleDraftDbxUpload();
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
    state.attachments = parsed.attachments || [];
    state.audit = parsed.audit || [];
    state.includeAudit = Boolean(parsed.includeAudit);
    state.completed = parsed.completed || state.completed;
    applyStateToForm();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/* ── 중간 저장(초안) — 저장 상태 표시 · 파일 · Dropbox 이어가기 ── */

function getDraftSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function draftHasContent(snap) {
  if (!snap || !snap.data) return false;
  const d = snap.data;
  const sig = snap.signatures || {};
  return Boolean(
    d.creditorName ||
      d.debtorName ||
      d.principalNumber ||
      (sig.creditor && sig.creditor.dataUrl) ||
      (sig.debtor && sig.debtor.dataUrl) ||
      (snap.attachments && snap.attachments.length),
  );
}

function renderResumeCard() {
  const card = elements.resumeCard;
  if (!card) return;
  const snap = getDraftSnapshot();
  if (!draftHasContent(snap)) {
    card.hidden = true;
    card.innerHTML = "";
    return;
  }
  const who = snap.data.creditorName || snap.data.debtorName || "작성 중인 계약";
  const stepNo = Math.min((snap.currentStep || 0) + 1, steps.length);
  const when = snap.exportedAt ? formatKoreanDateTime(snap.exportedAt) : "";
  card.hidden = false;
  card.innerHTML =
    `<div class="resume-info"><strong>이어서 작성할 내용이 있어요</strong>` +
    `<span>${escapeHtml(who)} · ${stepNo}/${steps.length}단계${when ? " · 저장 " + escapeHtml(when) : ""}</span></div>` +
    `<button class="primary-button small" type="button" data-action="restore">이어서 작성</button>`;
}

function updateSaveBadge(iso) {
  const badge = elements.saveBadge;
  if (!badge) return;
  const t = iso ? new Date(iso) : new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  badge.textContent = `자동 저장됨 · ${hh}:${mm}`;
  badge.classList.add("saved");
}

// 현재 작성 내용을 파일로 저장 (다른 기기로 옮기거나 상대에게 전달)
function downloadDraftFile() {
  const snapshot = exportState();
  const payload = { type: "easy-loan-note-draft", version: 1, exportedAt: new Date().toISOString(), snapshot };
  const now = new Date();
  const stamp =
    formatDateInput(now).replaceAll("-", "") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0");
  downloadBlob(`차용증-초안-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

// 초안 파일 불러와 이어서 작성
async function importDraftFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const snap =
      parsed && parsed.type === "easy-loan-note-draft" && parsed.snapshot
        ? parsed.snapshot
        : parsed && parsed.data
          ? parsed
          : null;
    if (!snap || !snap.data) throw new Error("초안 파일 형식이 올바르지 않습니다.");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    restoreDraft();
    showWorkspace();
    updateAll();
    scheduleSave();
  } catch (error) {
    alert(`초안 파일을 불러오지 못했습니다: ${error && error.message ? error.message : error}`);
  }
}

/* ── Dropbox 초안 동기화 (다른 기기에서 이어가기) ── */
const DBX_DRAFT_PATH = "/easy-loan-note-draft.json";
let draftDbxTimer = null;

async function dbxUploadDraft() {
  if (!dbxConnected()) return false;
  const snap = getDraftSnapshot();
  if (!snap) return false;
  const arg = JSON.stringify({ path: DBX_DRAFT_PATH, mode: "overwrite", autorename: false, mute: true });
  const upload = (token) =>
    fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": arg },
      body: JSON.stringify(snap),
    });
  try {
    let token = localStorage.getItem(DBX_TOKEN_KEY);
    let res = token ? await upload(token) : null;
    if (!res || res.status === 401) {
      token = await dbxRefreshToken();
      if (token) res = await upload(token);
    }
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function dbxDownloadDraft() {
  if (!dbxConnected()) return null;
  const arg = JSON.stringify({ path: DBX_DRAFT_PATH });
  const download = (token) =>
    fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": arg },
    });
  try {
    let token = localStorage.getItem(DBX_TOKEN_KEY);
    let res = token ? await download(token) : null;
    if (!res || res.status === 401) {
      token = await dbxRefreshToken();
      if (token) res = await download(token);
    }
    if (!res || !res.ok) return null; // 409(파일 없음) 포함
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

async function dbxDeleteDraft() {
  if (!dbxConnected()) return;
  const del = (token) =>
    fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: DBX_DRAFT_PATH }),
    });
  try {
    let token = localStorage.getItem(DBX_TOKEN_KEY);
    let res = token ? await del(token) : null;
    if (!res || res.status === 401) {
      token = await dbxRefreshToken();
      if (token) res = await del(token);
    }
  } catch {
    // 삭제 실패는 무시 (다음 업로드가 덮어씀)
  }
}

function scheduleDraftDbxUpload() {
  if (!dbxConnected()) return;
  window.clearTimeout(draftDbxTimer);
  draftDbxTimer = window.setTimeout(() => {
    dbxUploadDraft().catch(() => {});
  }, 4000);
}

// 앱 시작 시 원격 초안이 더 최신이면 가져와 이어갈 수 있게 함
async function dbxPullDraftIfNewer() {
  if (!dbxConnected()) return;
  const remote = await dbxDownloadDraft();
  if (!draftHasContent(remote)) return;
  const local = getDraftSnapshot();
  const rt = new Date(remote.exportedAt || 0).getTime();
  const lt = local ? new Date(local.exportedAt || 0).getTime() : -1;
  if (rt <= lt) return;
  // 작성 중이면 건드리지 않음 (인트로에 있을 때만 채택)
  if (elements.workspace && !elements.workspace.hidden) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
  restoreDraft();
  renderResumeCard();
}

function exportState() {
  readFormIntoState();
  return {
    version: 4,
    currentStep: state.currentStep,
    data: state.data,
    signatures: state.signatures,
    attachments: state.attachments,
    audit: state.audit,
    includeAudit: state.includeAudit,
    completed: state.completed,
    exportedAt: new Date().toISOString(),
  };
}

function hasDraftContent() {
  readFormIntoState();
  return Boolean(
    state.data.creditorName ||
      state.data.debtorName ||
      state.data.principalNumber ||
      state.signatures.creditor.dataUrl ||
      state.signatures.debtor.dataUrl ||
      state.attachments.length,
  );
}

function clearAllState() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(COMPLETED_STORAGE_KEY);
  window.clearTimeout(draftDbxTimer);
  dbxDeleteDraft().catch(() => {}); // 원격 초안도 정리
  elements.form.reset();
  state.currentStep = 0;
  state.data = {};
  state.signatures = {
    creditor: { dataUrl: "", signedAt: "" },
    debtor: { dataUrl: "", signedAt: "" },
    guarantor: { dataUrl: "", signedAt: "" },
  };
  state.attachments = [];
  state.audit = [];
  state.includeAudit = false;
  state.completed = { contractNumber: "", completedAt: "", documentHash: "", userAgent: "", timeZone: "" };
  setDefaultDates();
  signaturePads.forEach((pad) => pad.clear());
  renderAttachmentList();
}

function resetApp() {
  if (!confirm("작성 중인 내용과 현재 서명을 지우고 새 차용증을 작성할까요?")) return;
  clearAllState();
  showWorkspace();
  updateAll();
}

async function importJsonBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !parsed.data) {
      throw new Error("백업 파일 형식이 올바르지 않습니다.");
    }
    state.data = parsed.data || {};
    state.signatures = {
      creditor: { dataUrl: "", signedAt: "" },
      debtor: { dataUrl: "", signedAt: "" },
      guarantor: { dataUrl: "", signedAt: "" },
      ...(parsed.signatures || {}),
    };
    state.attachments = parsed.attachments || [];
    state.audit = parsed.audit || [];
    state.includeAudit = Boolean(parsed.includeAudit);
    state.completed = parsed.completed || { contractNumber: "", completedAt: "", documentHash: "", userAgent: "", timeZone: "" };
    state.currentStep = state.completed.completedAt
      ? 5
      : Math.min(Math.max(parsed.currentStep || 0, 0), 4);
    applyStateToForm();
    renderAttachmentList();
    if (state.completed.completedAt) archiveCurrentContract();
    showWorkspace();
    updateAll();
    scheduleSave();
  } catch (error) {
    alert(`JSON 백업을 불러오지 못했습니다: ${error && error.message ? error.message : error}`);
  }
}

async function createDocumentHash() {
  const payload = JSON.stringify({
    data: state.data,
    signatures: state.signatures,
    attachments: state.attachments,
    audit: state.audit,
    contractNumber: state.completed.contractNumber,
    completedAt: state.completed.completedAt,
    userAgent: state.completed.userAgent,
    timeZone: state.completed.timeZone,
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

const DOC_CSS = `
  .contract-doc { color: #111; background: #fff; margin: 0;
    font-family: -apple-system, 'SF Pro Text', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 13px; line-height: 19px; word-break: keep-all; overflow-wrap: anywhere; }
  .contract-doc h1 { font-size: 22px; line-height: 30px; text-align: center; margin: 0 0 12px; }
  .contract-doc h2 { font-size: 15px; line-height: 20px; margin: 14px 0 5px; }
  .contract-doc h3 { font-size: 13px; line-height: 18px; margin: 0 0 4px; }
  .contract-doc p { margin: 4px 0; }
  .contract-doc table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  .contract-doc th, .contract-doc td { border: 1px solid #D4D4D8; padding: 4px 7px; text-align: left; font-size: 12px; vertical-align: top; }
  .contract-doc th { background: #F3F3F5; }
  .contract-doc .party-table { table-layout: fixed; }
  .contract-doc .party-table th, .contract-doc .party-table td { word-break: keep-all; overflow-wrap: anywhere; }
  .contract-doc ol { padding-left: 20px; margin: 4px 0; }
  .contract-doc li { margin-bottom: 2px; }
  .contract-doc .contract-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px;
    border: 1px solid #D4D4D8; border-radius: 8px; padding: 9px 11px; margin: 10px 0; font-size: 11px; line-height: 16px; }
  .contract-doc .contract-meta p { margin: 0; }
  .contract-doc .signature-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
  .contract-doc .signature-print-box { border: 1px solid #888; border-radius: 8px; padding: 9px 11px; min-height: 112px; }
  .contract-doc .signature-print-box img { display: block; max-width: 100%; height: 58px; margin: 6px 0;
    object-fit: contain; border-bottom: 1px solid #aaa; }
  .contract-doc figure { margin: 0; }
  .contract-doc .attachment-print-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 8px; }
  .contract-doc .attachment-print img { display: block; max-width: 100%; border: 1px solid #D4D4D8; border-radius: 8px; }
  .contract-doc .attachment-print figcaption { margin-top: 3px; font-size: 11px; color: #666; }
  .contract-doc .audit-device { margin-top: 4px; font-size: 10.5px; color: #888; overflow-wrap: anywhere; }
  .contract-doc .summary-note { margin-top: 6px; font-size: 11.5px; color: #666; }
`;

function downloadFinalHtml() {
  updateDocuments();
  const title = `easy-loan-note-${state.completed.contractNumber || "draft"}.html`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{max-width:760px;margin:0 auto;padding:32px 20px;background:#fff}${DOC_CSS}@media print{@page{size:A4;margin:14mm}body{padding:0}}</style></head><body><article class="contract-doc">${elements.printDocument.innerHTML}</article></body></html>`;
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
