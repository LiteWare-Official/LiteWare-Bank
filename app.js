import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, runTransaction,
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp,
  limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBG22G7LF-ZgXH8i9HqBLEH6CO5erbUigU",
  authDomain: "liteware-l.firebaseapp.com",
  projectId: "liteware-l",
  storageBucket: "liteware-l.firebasestorage.app",
  messagingSenderId: "888260779479",
  appId: "1:888260779479:web:54c65b72f35167d642ff92",
  measurementId: "G-XM3WVG86TJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentProfile = null;
let unsubTx = null;
let html5QrScanner = null;

const $ = (id) => document.getElementById(id);
const overlay = $("loadingOverlay");
const showLoading = (on) => overlay.classList.toggle("active", on);

function fmtMoney(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genAccountNumber() {
  return "LW" + Math.floor(1e9 + Math.random() * 8e9).toString();
}

function genCardNumber() {
  let digits = "4526";
  for (let i = 0; i < 11; i++) digits += Math.floor(Math.random() * 10);
  // Luhn check digit
  let sum = 0, alt = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  digits += ((10 - (sum % 10)) % 10).toString();
  return digits.match(/.{1,4}/g).join(" ");
}

function genCVV() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, "0");
}

function genExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 4);
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getFullYear()).slice(-2);
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin + ":" + currentUser.uid);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------- Auth screen ----------------
$("toggleLogin").onclick = () => setAuthMode(true);
$("toggleRegister").onclick = () => setAuthMode(false);
function setAuthMode(login) {
  $("toggleLogin").classList.toggle("active", login);
  $("toggleRegister").classList.toggle("active", !login);
  $("authNameField").style.display = login ? "none" : "block";
  $("authPhoneField").style.display = login ? "none" : "block";
  $("authSubmit").textContent = login ? "Sign in" : "Create account";
  $("authForm").dataset.mode = login ? "login" : "register";
  $("authNote").textContent = "";
}
setAuthMode(true);

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();
  const phone = $("authPhone").value.trim();
  const mode = $("authForm").dataset.mode;
  $("authNote").textContent = "";
  showLoading(true);
  try {
    if (mode === "register") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: name || email.split("@")[0],
        email,
        phone,
        balance: 0,
        accountNumber: genAccountNumber(),
        cardNumber: genCardNumber(),
        cardCVV: genCVV(),
        cardExpiry: genExpiry(),
        frozen: false,
        createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    $("authNote").textContent = err.message.replace("Firebase: ", "");
  } finally {
    showLoading(false);
  }
});

$("logoutBtn").onclick = () => signOut(auth);

// ---------------- Auth state ----------------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (unsubTx) { unsubTx(); unsubTx = null; }
  $("phoneGate").classList.remove("active");
  if (!user) {
    show("authScreen");
    return;
  }
  showLoading(true);
  const snap = await getDoc(doc(db, "users", user.uid));
  currentProfile = snap.data();
  showLoading(false);
  if (!currentProfile) return;

  // Backfill card details for accounts created before this feature existed.
  if (!currentProfile.cardNumber) {
    const patch = { cardNumber: genCardNumber(), cardCVV: genCVV(), cardExpiry: genExpiry() };
    await updateDoc(doc(db, "users", user.uid), patch);
    currentProfile = { ...currentProfile, ...patch };
  }

  // Accounts created before phone numbers were required must supply one now.
  if (!currentProfile.phone) {
    $("phoneGate").classList.add("active");
    return;
  }
  enterApp();
});

$("phoneGateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = $("phoneGateInput").value.trim();
  if (!phone) return;
  $("phoneGateNote").textContent = "";
  showLoading(true);
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { phone });
    currentProfile.phone = phone;
    $("phoneGate").classList.remove("active");
    enterApp();
  } catch (err) {
    $("phoneGateNote").textContent = err.message;
  } finally {
    showLoading(false);
  }
});

function enterApp() {
  renderDashboard();
  renderReceiveQR();
  renderProfile();
  listenTransactions();
  show("appScreen");
  switchTab("dashboard");
}

function show(id) {
  ["authScreen", "appScreen"].forEach(s => $(s).style.display = (s === id ? "block" : "none"));
}

// ---------------- Tabs ----------------
document.querySelectorAll(".tabs button").forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + tab));
  if (tab === "pay") startScanner(); else stopScanner();
}

// ---------------- Dashboard ----------------
function renderDashboard() {
  $("balanceFigure").innerHTML = `<sup>$</sup>${fmtMoney(currentProfile.balance)}`;
  $("acctNumber").textContent = "Account " + currentProfile.accountNumber;
  $("statusPill").textContent = currentProfile.frozen ? "Frozen" : "Active";
  $("statusPill").classList.toggle("frozen", !!currentProfile.frozen);
  $("greetName").textContent = currentProfile.name;
}

function renderProfile() {
  $("profileName").textContent = currentProfile.name || "—";
  $("profileEmail").textContent = currentProfile.email || "—";
  $("profilePhone").textContent = currentProfile.phone || "—";
  $("profileAcct").textContent = currentProfile.accountNumber || "—";
  $("cardHolder").textContent = (currentProfile.name || "").toUpperCase();
  $("cardNumberDisplay").textContent = currentProfile.cardNumber || "";
  $("cardExpiryDisplay").textContent = currentProfile.cardExpiry || "";
  $("cardCVVDisplay").textContent = currentProfile.cardCVV || "";
}

function renderReceiveQR() {
  $("qrReceive").innerHTML = "";
  const payload = JSON.stringify({ uid: currentUser.uid, acct: currentProfile.accountNumber });
  new QRCode($("qrReceive"), { text: payload, width: 200, height: 200, colorDark: "#12161B", colorLight: "#ffffff" });
}

// ---------------- Transactions ----------------
let txCache = {};

function listenTransactions() {
  const q = query(
    collection(db, "transactions"),
    where("participants", "array-contains", currentUser.uid),
    orderBy("createdAt", "desc"),
    limit(200)
  );
  unsubTx = onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach(d => {
      const row = { id: d.id, ...d.data() };
      rows.push(row);
      txCache[row.id] = row;
    });
    renderLedger($("ledgerList"), rows.slice(0, 6));
    renderLedger($("historyList"), rows);
  }, (err) => {
    const msg = err.code === "failed-precondition"
      ? `Transaction history needs a Firestore index. Open the browser console and click the link Firebase prints, or create one manually: Firestore → Indexes → Composite → collection "transactions", fields "participants" (Arrays) + "createdAt" (Descending).`
      : `Couldn't load transaction history: ${err.message}`;
    $("ledgerList").innerHTML = `<div class="empty-note note error">${msg}</div>`;
    $("historyList").innerHTML = `<div class="empty-note note error">${msg}</div>`;
  });
}

function renderLedger(el, rows) {
  if (!rows.length) {
    el.innerHTML = `<div class="empty-note">No transactions yet. Receive or send money to see activity here.</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const incoming = r.toUid === currentUser.uid;
    const sign = incoming ? "+" : "−";
    const other = incoming ? r.fromName : r.toName;
    const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "just now";
    return `<div class="ledger-row" data-txid="${r.id}" style="cursor:pointer">
      <div>
        <div class="who">${incoming ? "From" : "To"} ${escapeHtml(other || "Unknown")}</div>
        <div class="meta">${when} · ${r.status}</div>
      </div>
      <div class="amt ${incoming ? "in" : "out"}">${sign}$${fmtMoney(r.amount)}</div>
    </div>`;
  }).join("");
}

$("ledgerList").addEventListener("click", (e) => {
  const row = e.target.closest(".ledger-row");
  if (row && txCache[row.dataset.txid]) openReceipt(txCache[row.dataset.txid]);
});
$("historyList").addEventListener("click", (e) => {
  const row = e.target.closest(".ledger-row");
  if (row && txCache[row.dataset.txid]) openReceipt(txCache[row.dataset.txid]);
});

// ---------------- Receipt ----------------
function openReceipt(tx) {
  txCache[tx.id] = tx;
  const incoming = tx.toUid === currentUser.uid;
  const when = tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString() : "just now";
  const rows = [
    ["Amount", `$${fmtMoney(tx.amount)}`],
    ["Direction", incoming ? "Received" : "Sent"],
    [incoming ? "From" : "To", incoming ? (tx.fromName || "Unknown") : (tx.toName || "Unknown")],
    ["Type", tx.type === "admin_adjustment" ? "Admin adjustment" : "QR payment"],
    ["Status", tx.status],
    ["Date", when],
    ["Transaction ID", tx.id]
  ];
  $("receiptBody").innerHTML = rows.map(([label, value]) => `
    <div class="ledger-row">
      <div class="who">${escapeHtml(label)}</div>
      <div class="meta" style="text-align:right">${escapeHtml(String(value))}</div>
    </div>`).join("");
  $("receiptModal").classList.add("active");
}
$("closeReceipt").onclick = () => $("receiptModal").classList.remove("active");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- QR scan (pay) ----------------
function startScanner() {
  if (html5QrScanner || currentProfile?.frozen) return;
  $("scanNote").textContent = currentProfile?.frozen ? "Your account is frozen. Payments are disabled." : "";
  if (currentProfile?.frozen) return;
  html5QrScanner = new Html5Qrcode("reader");
  html5QrScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    (decodedText) => {
      stopScanner();
      openPayConfirm(decodedText);
    },
    () => {}
  ).catch(err => {
    $("scanNote").textContent = "Camera unavailable: " + err;
  });
}
function stopScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => html5QrScanner.clear()).catch(() => {});
    html5QrScanner = null;
  }
}

// ---------------- QR from file ----------------
$("qrFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("fileScanNote").textContent = "";
  stopScanner();
  const fileScanner = new Html5Qrcode("reader");
  try {
    const decodedText = await fileScanner.scanFile(file, false);
    openPayConfirm(decodedText);
  } catch (err) {
    $("fileScanNote").textContent = "Couldn't read a QR code from that image.";
  } finally {
    try { fileScanner.clear(); } catch {}
    e.target.value = "";
  }
});

async function openPayConfirm(decodedText) {
  let data;
  try { data = JSON.parse(decodedText); } catch { data = null; }
  if (!data || !data.uid) {
    $("scanNote").textContent = "That QR code isn't a valid receive code.";
    setTimeout(startScanner, 1200);
    return;
  }
  if (data.uid === currentUser.uid) {
    $("scanNote").textContent = "You can't pay yourself.";
    setTimeout(startScanner, 1200);
    return;
  }
  await openPayConfirmForUid(data.uid, data.acct);
}

async function openPayConfirmForUid(uid, acctHint) {
  $("payForm").dataset.targetUid = uid;
  $("payTargetName").textContent = "Loading…";
  $("payTargetAcct").textContent = acctHint || "";
  $("payForm").style.display = "block";
  $("payAmount").value = "";
  $("payNote").textContent = "";

  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      $("payTargetName").textContent = "Unknown account";
      return;
    }
    const recv = snap.data();
    $("payTargetName").textContent = recv.name || "Unnamed account";
    $("payTargetAcct").textContent = recv.accountNumber || acctHint || "";
    if (recv.frozen) $("payNote").textContent = "This account is frozen and can't receive payments.";
  } catch (err) {
    $("payTargetName").textContent = "Couldn't load recipient.";
  }
}

// ---------------- Pay by phone / email ----------------
$("lookupBtn").addEventListener("click", async () => {
  const val = $("lookupInput").value.trim();
  $("lookupNote").textContent = "";
  if (!val) {
    $("lookupNote").textContent = "Enter a phone number or email.";
    return;
  }
  showLoading(true);
  try {
    const field = val.includes("@") ? "email" : "phone";
    const q = query(collection(db, "users"), where(field, "==", val), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      $("lookupNote").textContent = "No account found for that " + (field === "email" ? "email" : "phone number") + ".";
      return;
    }
    const found = snap.docs[0];
    if (found.id === currentUser.uid) {
      $("lookupNote").textContent = "You can't pay yourself.";
      return;
    }
    stopScanner();
    await openPayConfirmForUid(found.id, found.data().accountNumber);
  } catch (err) {
    $("lookupNote").textContent = err.message;
  } finally {
    showLoading(false);
  }
});

$("cancelPay").onclick = () => {
  $("payForm").style.display = "none";
  startScanner();
};

$("payForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const toUid = $("payForm").dataset.targetUid;
  const amountCents = Math.round(parseFloat($("payAmount").value) * 100);
  $("payNote").textContent = "";
  if (!amountCents || amountCents <= 0) {
    $("payNote").textContent = "Enter a valid amount.";
    return;
  }
  openPinFlow({ toUid, amountCents });
});

// ---------------- Payment PIN ----------------
let pendingPayment = null;
let pinMode = "enter";

async function openPinFlow(payment) {
  pendingPayment = payment;
  showLoading(true);
  let hasPin = false;
  try {
    const secSnap = await getDoc(doc(db, "users", currentUser.uid, "private", "security"));
    hasPin = secSnap.exists() && !!secSnap.data().pinHash;
  } catch (err) {
    $("payNote").textContent = "Couldn't check your PIN: " + err.message;
    showLoading(false);
    return;
  }
  showLoading(false);
  pinMode = hasPin ? "enter" : "create";
  $("pinInput").value = "";
  $("pinConfirmInput").value = "";
  $("pinNote").textContent = "";
  if (pinMode === "create") {
    $("pinModalTitle").textContent = "Create a payment PIN";
    $("pinModalSub").textContent = "Set a 4–6 digit PIN. You'll enter it to confirm every payment.";
    $("pinConfirmField").style.display = "block";
  } else {
    $("pinModalTitle").textContent = "Enter your PIN";
    $("pinModalSub").textContent = "Confirm this payment with your payment PIN.";
    $("pinConfirmField").style.display = "none";
  }
  $("pinModal").classList.add("active");
  $("pinInput").focus();
}

$("pinCancel").onclick = () => {
  $("pinModal").classList.remove("active");
  pendingPayment = null;
};

$("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $("pinInput").value.trim();
  $("pinNote").textContent = "";
  if (!/^\d{4,6}$/.test(pin)) {
    $("pinNote").textContent = "PIN must be 4–6 digits.";
    return;
  }
  if (pinMode === "create") {
    const confirmPin = $("pinConfirmInput").value.trim();
    if (pin !== confirmPin) {
      $("pinNote").textContent = "PINs don't match.";
      return;
    }
    showLoading(true);
    try {
      const hash = await hashPin(pin);
      await setDoc(doc(db, "users", currentUser.uid, "private", "security"), { pinHash: hash });
      $("pinModal").classList.remove("active");
      await executePendingPayment();
    } catch (err) {
      $("pinNote").textContent = err.message;
    } finally {
      showLoading(false);
    }
  } else {
    showLoading(true);
    try {
      const secSnap = await getDoc(doc(db, "users", currentUser.uid, "private", "security"));
      const stored = secSnap.exists() ? secSnap.data().pinHash : null;
      const hash = await hashPin(pin);
      if (hash !== stored) {
        $("pinNote").textContent = "Incorrect PIN.";
        showLoading(false);
        return;
      }
      $("pinModal").classList.remove("active");
      await executePendingPayment();
    } catch (err) {
      $("pinNote").textContent = err.message;
    } finally {
      showLoading(false);
    }
  }
});

async function executePendingPayment() {
  if (!pendingPayment) return;
  const { toUid, amountCents } = pendingPayment;
  pendingPayment = null;
  showLoading(true);
  try {
    const result = await sendPayment(currentUser.uid, toUid, amountCents);
    $("payForm").style.display = "none";
    switchTab("dashboard");
    openReceipt(result);
  } catch (err) {
    $("payNote").textContent = err.message;
  } finally {
    showLoading(false);
  }
}

// Atomic transfer via Firestore transaction (client-side; secured by Firestore rules)
async function sendPayment(fromUid, toUid, amountCents) {
  const fromRef = doc(db, "users", fromUid);
  const toRef = doc(db, "users", toUid);

  const result = await runTransaction(db, async (tx) => {
    const fromSnap = await tx.get(fromRef);
    const toSnap = await tx.get(toRef);
    if (!fromSnap.exists() || !toSnap.exists()) throw new Error("Account not found.");
    const from = fromSnap.data();
    const to = toSnap.data();
    if (from.frozen) throw new Error("Your account is frozen.");
    if (to.frozen) throw new Error("Recipient account is frozen.");
    if (from.balance < amountCents) throw new Error("Insufficient balance.");

    tx.update(fromRef, { balance: from.balance - amountCents });
    tx.update(toRef, { balance: to.balance + amountCents });
    return { fromName: from.name, toName: to.name };
  });

  const txDoc = await addDoc(collection(db, "transactions"), {
    fromUid, toUid,
    fromName: result.fromName, toName: result.toName,
    participants: [fromUid, toUid],
    amount: amountCents,
    type: "qr_payment",
    status: "completed",
    createdAt: serverTimestamp()
  });

  const freshSnap = await getDoc(doc(db, "users", fromUid));
  currentProfile = freshSnap.data();
  renderDashboard();

  return {
    id: txDoc.id,
    fromUid, toUid,
    fromName: result.fromName, toName: result.toName,
    amount: amountCents,
    type: "qr_payment",
    status: "completed",
    createdAt: { toDate: () => new Date() }
  };
}
