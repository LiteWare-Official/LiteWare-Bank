import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, updateDoc, collection, addDoc, getDocs,
  query, orderBy, limit, serverTimestamp
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

// The admin signs in with a username, which maps to a real Firebase Auth
// email behind the scenes. Create this user once in the Firebase console
// (Authentication tab) and add a matching doc at admins/{uid} — see README.
const USERNAME_TO_EMAIL = {
  admin: "admin@liteware.me"
};

const $ = (id) => document.getElementById(id);
let allUsers = [];

$("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("adminUsername").value.trim().toLowerCase();
  const password = $("adminPassword").value;
  $("adminLoginNote").textContent = "";

  const email = USERNAME_TO_EMAIL[username];
  if (!email) {
    $("adminLoginNote").textContent = "Unknown username.";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    $("adminLoginNote").textContent = "Invalid username or password.";
  }
});

$("adminLogout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    show("adminLoginScreen");
    return;
  }
  const claimSnap = await getDoc(doc(db, "admins", user.uid));
  if (!claimSnap.exists()) {
    $("adminLoginNote").textContent = "This account has no admin access.";
    await signOut(auth);
    return;
  }
  show("adminScreen");
  await loadUsers();
  await loadTransactions();
});

function show(id) {
  ["adminLoginScreen", "adminScreen"].forEach(s => $(s).style.display = (s === id ? "block" : "none"));
}

async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  allUsers = [];
  snap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
  renderUsers(allUsers);
}

function renderUsers(list) {
  $("usersBody").innerHTML = list.map(u => `
    <tr>
      <td>${escapeHtml(u.name || "—")}</td>
      <td>${escapeHtml(u.accountNumber || "—")}</td>
      <td>$${((u.balance || 0) / 100).toFixed(2)}</td>
      <td><span class="pill ${u.frozen ? "frozen" : ""}">${u.frozen ? "Frozen" : "Active"}</span></td>
      <td>
        <button class="btn secondary" style="width:auto;padding:6px 10px;font-size:12px" data-action="toggle" data-id="${u.id}">${u.frozen ? "Unfreeze" : "Freeze"}</button>
        <button class="btn secondary" style="width:auto;padding:6px 10px;font-size:12px" data-action="adjust" data-id="${u.id}">Adjust</button>
      </td>
    </tr>`).join("");
}

$("userSearch").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderUsers(allUsers.filter(u =>
    (u.name || "").toLowerCase().includes(q) || (u.accountNumber || "").toLowerCase().includes(q)
  ));
});

$("usersBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const user = allUsers.find(u => u.id === id);
  if (btn.dataset.action === "toggle") {
    await updateDoc(doc(db, "users", id), { frozen: !user.frozen });
    await loadUsers();
  } else if (btn.dataset.action === "adjust") {
    openAdjust(user);
  }
});

function openAdjust(user) {
  $("adjustName").textContent = `${user.name} · ${user.accountNumber}`;
  $("adjustForm").dataset.id = user.id;
  $("adjustAmount").value = "";
  $("adjustNote").textContent = "";
  $("adjustModal").style.display = "flex";
}
$("closeAdjust").onclick = () => $("adjustModal").style.display = "none";

$("adjustForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("adjustForm").dataset.id;
  const delta = Math.round(parseFloat($("adjustAmount").value) * 100);
  if (!delta) { $("adjustNote").textContent = "Enter a non-zero amount."; return; }
  const user = allUsers.find(u => u.id === id);
  const newBalance = (user.balance || 0) + delta;
  if (newBalance < 0) { $("adjustNote").textContent = "Balance can't go negative."; return; }

  await updateDoc(doc(db, "users", id), { balance: newBalance });
  await addDoc(collection(db, "transactions"), {
    fromUid: delta < 0 ? id : "admin",
    toUid: delta < 0 ? "admin" : id,
    fromName: delta < 0 ? user.name : "Admin adjustment",
    toName: delta < 0 ? "Admin adjustment" : user.name,
    participants: [id],
    amount: Math.abs(delta),
    type: "admin_adjustment",
    status: "completed",
    createdAt: serverTimestamp()
  });
  $("adjustModal").style.display = "none";
  await loadUsers();
});

async function loadTransactions() {
  const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(q);
  const rows = [];
  snap.forEach(d => rows.push(d.data()));
  $("txBody").innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.fromName || r.fromUid || "—")}</td>
      <td>${escapeHtml(r.toName || r.toUid || "—")}</td>
      <td>$${((r.amount || 0) / 100).toFixed(2)}</td>
      <td>${escapeHtml(r.type || "—")}</td>
      <td>${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "—"}</td>
    </tr>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
