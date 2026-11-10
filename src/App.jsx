import { createWorker } from "tesseract.js";
import { useState, useEffect, useRef } from "react";
import {
  supabase,
  getGoogleProviderTokenStatus,
  getGoogleProviderTokens,
} from "./lib/supabase";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
/* ---------- DATA ---------- */

const seedVehicles = [
  { id: 1, name: "Royal Enfield Thunderbird 350X", variant: "350cc · ABS", type: "Motorcycle", km: "" },
  { id: 2, name: "Honda Activa", variant: "2012 · Scooter", type: "Scooter", km: "" },
  { id: 3, name: "Honda Dio DLX", variant: "110cc · DLX", type: "Scooter", km: "" },
  { id: 4, name: "Maruti Suzuki A-Star", variant: "2011 VXi · ABS · Automatic", type: "Car", km: "" },
  { id: 5, name: "Honda Amaze", variant: "3rd Gen · ZX CVT · Petrol", type: "Car", km: "" },
];

const ICONS = { Motorcycle: "🏍️", Scooter: "🛵", Car: "🚗", Other: "🚘" };
const VEHICLE_TYPES = ["Motorcycle", "Scooter", "Car", "Other"];
const DOC_TYPES = ["Insurance", "PUC", "RC", "Driving Licence", "Tax", "Fitness", "Permit", "Other"];
const DEFAULT_INTERVALS = [30, 15, 7, 3, 1];
const INTERVAL_OPTIONS = [60, 45, 30, 15, 10, 7, 5, 3, 2, 1];

const menu = [
  ["▦", "Dashboard"],
  ["🚘", "My Vehicles"],
  ["▤", "Documents"],
  ["🔧", "Maintenance"],
  ["⚠", "Problems & Repairs"],
  ["◷", "Reminders"],
  ["🔔", "Alerts"],
  ["⛽", "Fuel Tracking"],
  ["₹", "Expenses"],
  ["₹", "FASTag"],
  ["🆘", "SOS & Emergency"],
  ["📊", "Reports"],
];

/* ---------- HELPERS ---------- */

function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  }, [key, value]);
  return [value, setValue];
}

function daysLeft(iso) {
  if (!iso || typeof iso !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((date - today) / 86400000);
}
function formatDate(iso) {
  const days = daysLeft(iso);
  if (days === null) return "Not entered";

  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Alert stages: 30, 15, 7, 3, 1 days, expiry day, and expired
function alertInfo(days) {
  if (days < 0)
    return { alert: true, cls: "danger", label: `Expired ${-days} day${-days === 1 ? "" : "s"} ago` };
  if (days === 0) return { alert: true, cls: "danger", label: "Expires today" };
  if (days <= 1) return { alert: true, cls: "danger", label: "1 day left" };
  if (days <= 3) return { alert: true, cls: "danger", label: `${days} days left` };
  if (days <= 7) return { alert: true, cls: "orange", label: `${days} days left` };
  if (days <= 15) return { alert: true, cls: "warning", label: `${days} days left` };
  if (days <= 30) return { alert: true, cls: "info", label: `${days} days left` };
  return { alert: false, cls: "ok", label: `Valid · ${days} days` };
}

// Which alert stage a document is in, based on the user's chosen intervals
function alertStage(days, intervals) {
  if (days < 0) return "expired";
  if (days === 0) return "today";
  const sorted = [...intervals].sort((x, y) => x - y);
  const hit = sorted.find((n) => days <= n);
  return hit === undefined ? null : hit;
}

function stageLabel(stage) {
  if (stage === "expired") return "Expired";
  if (stage === "today") return "Expires today";
  return `${stage}-day warning`;
}

function docName(d) {
  return d.type === "Other" ? d.label || "Other" : d.type;
}

/* ---------- APP ---------- */

function App() {
  const [session, setSession] = useState(null);
  const [gmailTokenStatus, setGmailTokenStatus] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const syncQueue = useRef(Promise.resolve());

  const [active, setActive] = useState("Dashboard");
  const [vehicles, setVehicles] = useStored("mygarage.vehicles.v1", seedVehicles);
  const [documents, setDocuments] = useStored("mygarage.documents.v1", []);
  const [maintenance, setMaintenance] = useStored("mygarage.maintenance.v1", []);
  const [alertState, setAlertState] = useStored("mygarage.alertstate.v1", {});
  const [settings, setSettings] = useStored("mygarage.settings.v1", {
    intervals: DEFAULT_INTERVALS,
    browser: false,
  });
  const [notified, setNotified] = useStored("mygarage.notified.v1", []);
  const [toasts, setToasts] = useState([]);
  const [bellOpen, setBellOpen] = useState(false);

  // Restore the Supabase session and listen for login/logout changes.
  useEffect(() => {
    let mounted = true;

    function inspectGoogleProviderTokens(nextSession) {
      const capturedStatus = getGoogleProviderTokenStatus();
      if (capturedStatus.checked) {
        setGmailTokenStatus(capturedStatus);
        return;
      }
      if (!nextSession) return;
      setGmailTokenStatus({
        checked: true,
        hasAccessToken: Boolean(nextSession.provider_token),
        hasRefreshToken: Boolean(nextSession.provider_refresh_token),
      });
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      const currentSession = data?.session ?? null;
      setSession(currentSession);
      inspectGoogleProviderTokens(currentSession);
      setAuthLoading(false);
    });

   
const { data: authListener } = supabase.auth.onAuthStateChange(
  (_event, nextSession) => {
    if (!mounted) return;

    setSession(nextSession);
    inspectGoogleProviderTokens(nextSession);

    if (!nextSession?.user?.id) {
      setCloudReady(false);
      setCloudLoading(false);
      return;
    }

    const { refreshToken } = getGoogleProviderTokens();
    console.log("Gmail token-save trigger:", {
  event: _event,
  hasSession: Boolean(nextSession),
  hasSupabaseAccessToken: Boolean(nextSession?.access_token),
  hasRefreshToken: Boolean(refreshToken),
});

    if (refreshToken && nextSession.access_token) {
      // Run outside the auth callback to avoid blocking Supabase Auth.
      setTimeout(async () => {
        try {
          const { error } = await supabase.functions.invoke(
            "store-gmail-token",
            {
              body: { refreshToken },
              headers: {
                Authorization: `Bearer ${nextSession.access_token}`,
              },
            }
          );

         if (error) {
  let details = error.message;

  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      details = body.error || body.message || details;
    } catch {}
  }

  console.error("Gmail token storage failed:", details);
} else {
  console.log("Gmail refresh token securely stored.");
}
        } catch (error) {
          console.error("Gmail token storage failed:", error);
        }
      }, 0);
    }
  }
);


return () => {
  mounted = false;
  authListener.subscription.unsubscribe();
};
  }, []);

  // Load this account's cloud data. On the first account login only, migrate
  // the current browser's existing localStorage data if the cloud is empty.
  useEffect(() => {
    if (!session?.user?.id) {
      setCloudReady(false);
      setCloudLoading(false);
      return;
    }

    let cancelled = false;
    const userId = session.user.id;

    async function loadAccountData() {
      setCloudLoading(true);
      setCloudReady(false);
      setAuthError("");

      try {
        const [vehicleResult, documentResult, maintenanceResult, alertStateResult] =
        await Promise.all([
          supabase.from("vehicles").select("*").eq("user_id", userId),
          supabase.from("documents").select("*").eq("user_id", userId),
          supabase.from("maintenance_records").select("*").eq("user_id", userId),
          supabase.from("alert_states").select("*").eq("user_id", userId),
        ]);
 
        if (alertStateResult.error) throw alertStateResult.error;
        if (vehicleResult.error) throw vehicleResult.error;
        if (documentResult.error) throw documentResult.error;
        if (maintenanceResult.error) throw maintenanceResult.error;

        const cloudVehicles = vehicleResult.data ?? [];
      console.log(
  "VEHICLE REGISTRATION DATA:",
  cloudVehicles.map((row) => ({
    name: row.name,
    details: row.details,
    registration_number: row.registration_number,
  }))
);
        const cloudDocuments = documentResult.data ?? [];
        const cloudMaintenance = maintenanceResult.data ?? [];
        const migrationOwner = localStorage.getItem("mygarage.migratedUserId");
        const canMigrateLocal = !migrationOwner || migrationOwner === userId;
        const cloudAlertStates = alertStateResult.data ?? [];
        const toAppId = (id) => /^\d+$/.test(String(id)) ? Number(id) : id;
        if (cloudAlertStates.length > 0) {
          const restoredAlertState = Object.fromEntries(
  cloudAlertStates.map((row) => [
    row.id,
    {
      read: !!row.is_read,
      resolved: !!row.is_resolved,
      resolvedAt: row.resolved_at || null,
    },
  ])
);
          if (!cancelled) setAlertState(restoredAlertState);
        } else if (!canMigrateLocal) {
          if (!cancelled) setAlertState({});
        } else if (Object.keys(alertState).length > 0) {
          const rows = Object.entries(alertState).map(([id, state]) => ({
            user_id: userId,
            id,
            is_read: !!state.read,
            is_resolved: !!state.resolved,
            resolved_at: state.resolvedAt || null
            
          }));
          const { error } = await supabase.from("alert_states").insert(rows);
          if (error) throw error;
        }

        if (cloudVehicles.length > 0) {
          if (!cancelled) {
           setVehicles(cloudVehicles.map((row) => ({
  id: toAppId(row.id),
  name: row.name ?? "",
  variant: row.details?.variant ?? "",
  type: row.details?.type ?? "Other",
  km: row.details?.km ?? "",
  // Prefer a non-empty value from either supported database column.
  // An empty string in details must not hide a valid registration_number.
  registrationNumber: String(
    row.details?.registrationNumber || row.registration_number || ""
  ).trim(),
})));
          }
        } else if (canMigrateLocal && vehicles.length > 0) {
          const rows = vehicles.map((vehicle) => ({
            id: String(vehicle.id),
            user_id: userId,
            name: vehicle.name,
            registration_number: vehicle.registrationNumber?.trim() || null,
            details: {
  variant: vehicle.variant ?? "",
  type: vehicle.type ?? "Other",
  km: vehicle.km ?? "",
  registrationNumber: vehicle.registrationNumber?.trim() || "",
},
          }));
          const { error } = await supabase.from("vehicles").insert(rows);
          if (error) throw error;
        } else if (!canMigrateLocal && !cancelled) {
          setVehicles([]);
        }

        if (cloudDocuments.length > 0) {
          if (!cancelled) {
            setDocuments(cloudDocuments.map((row) => ({
  id: toAppId(row.id),
  vehicleId: toAppId(row.vehicle_id),
  type: row.type,
  label: row.label ?? "",
  number: row.number ?? "",
  issue: row.issue ?? "",
  expiry: row.expiry ?? "",
  filePath: row.file_path ?? "",
  fileName: row.file_name ?? "",
  fileMimeType: row.file_mime_type ?? "",
  fileSize: row.file_size ?? null,
  source: row.source ?? "manual",
})));
          }
        } else if (canMigrateLocal && documents.length > 0) {
          const rows = documents.map((document) => ({
            id: String(document.id),
            user_id: userId,
            vehicle_id: String(document.vehicleId),
            type: document.type,
            label: document.label || null,
            number: document.number || null,
            issue: document.issue || null,
            expiry: document.expiry || null,
          }));
          const { error } = await supabase.from("documents").insert(rows);
          if (error) throw error;
        } else if (!canMigrateLocal && !cancelled) {
          setDocuments([]);
        }

        if (cloudMaintenance.length > 0) {
          if (!cancelled) {
            setMaintenance(cloudMaintenance.map((row) => ({
              id: toAppId(row.id),
              vehicleId: toAppId(row.vehicle_id),
              date: row.date ?? "",
              odometer: row.odometer ?? "",
              type: row.type ?? "Other",
              cost: row.cost ?? "",
              nextDate: row.next_date ?? "",
              nextOdometer: row.next_odometer ?? "",
              nextServiceCompleted: !!row.next_service_completed,
              description: row.description ?? "",
            })));
          }
        } else if (canMigrateLocal && maintenance.length > 0) {
          const rows = maintenance.map((record) => ({
            id: String(record.id),
            user_id: userId,
            vehicle_id: String(record.vehicleId),
            date: record.date || null,
            odometer: record.odometer === "" ? null : record.odometer,
            type: record.type || null,
            cost: record.cost === "" ? null : record.cost,
            next_date: record.nextDate || null,
            next_odometer: record.nextOdometer === "" ? null : record.nextOdometer,
            next_service_completed: !!record.nextServiceCompleted,
            description: record.description || null,
          }));
          const { error } = await supabase.from("maintenance_records").insert(rows);
          if (error) throw error;
        } else if (!canMigrateLocal && !cancelled) {
          setMaintenance([]);
        }

        // Record which account claimed this browser's legacy local data. This
        // prevents a different account signing in on the same browser from
        // accidentally importing the previous account's local records.
        if (canMigrateLocal) {
          localStorage.setItem("mygarage.migratedUserId", userId);
        }

        if (!cancelled) setCloudReady(true);
      } catch (error) {
        console.error("MyGarage cloud load/migration failed:", error);
        if (!cancelled) {
          setAuthError(
            `Could not load your garage data: ${error.message || "Unknown error"}. Your browser data has not been intentionally cleared.`
          );
        }
      } finally {
        if (!cancelled) setCloudLoading(false);
      }
    }

    loadAccountData();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Keep the authenticated account's garage records synchronized with Supabase.
  // A serialized queue prevents rapid edits from racing each other.
  useEffect(() => {
    if (!cloudReady || !session?.user?.id) return;
    const userId = session.user.id;

    const vehicleRows = vehicles.map((vehicle) => ({
  id: String(vehicle.id),
  user_id: userId,
  name: vehicle.name,
  // Keep the dedicated column and JSON details field in sync.
  registration_number: vehicle.registrationNumber?.trim() || null,
  details: {
    variant: vehicle.variant ?? "",
    type: vehicle.type ?? "Other",
    km: vehicle.km ?? "",
    registrationNumber: vehicle.registrationNumber?.trim() || "",
  },
}));

   const documentRows = documents.map((document) => ({
  id: String(document.id),
  user_id: userId,
  vehicle_id: String(document.vehicleId),
  type: document.type,
  label: document.label || null,
  number: document.number || null,
  issue: document.issue || null,
  expiry: document.expiry || null,
  file_path: document.filePath || null,
  file_name: document.fileName || null,
  file_mime_type: document.fileMimeType || null,
  file_size: document.fileSize || null,
  source: document.source || "manual",
}));
    const maintenanceRows = maintenance.map((record) => ({
      id: String(record.id),
      user_id: userId,
      vehicle_id: String(record.vehicleId),
      date: record.date || null,
      odometer: record.odometer === "" ? null : record.odometer,
      type: record.type || null,
      cost: record.cost === "" ? null : record.cost,
      next_date: record.nextDate || null,
      next_odometer: record.nextOdometer === "" ? null : record.nextOdometer,
      next_service_completed: !!record.nextServiceCompleted,
      description: record.description || null,
    }));


    const alertStateRows = Object.entries(alertState).map(([id, state]) => ({
      user_id: userId,
      id,
      is_read: !!state.read,
      is_resolved: !!state.resolved,
      resolved_at: state.resolvedAt || null,
    }));

    async function syncTable(table, rows) {
      if (rows.length) {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }

      let deletion = supabase.from(table).delete().eq("user_id", userId);
      if (rows.length) {
        const ids = rows.map((row) => `"${String(row.id).replace(/"/g, '\\"')}"`).join(",");
        deletion = deletion.not("id", "in", `(${ids})`);
      }
      const { error } = await deletion;
      if (error) throw error;
    }

    syncQueue.current = syncQueue.current
      .then(async () => {
        await syncTable("vehicles", vehicleRows);
        await syncTable("documents", documentRows);
        await syncTable("maintenance_records", maintenanceRows);
        if (alertStateRows.length > 0) {
          const { error } = await supabase
          .from("alert_states")
          .upsert(alertStateRows, { onConflict: "user_id,id" });
          if (error) throw error;
        }
      })
      .catch((error) => {
        console.error("MyGarage cloud sync failed:", error);
        setAuthError(`Cloud sync issue: ${error.message || "Please check your connection and refresh."}`);
      });
    }, [cloudReady, session?.user?.id, vehicles, documents, maintenance, alertState]);
    async function handleAuthSubmit(event) {
      event.preventDefault();
      setAuthBusy(true);
      setAuthError("");
      setAuthMessage("");
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMessage("Account created. Check your email for the confirmation link, then return here to sign in.");
        } else {
          setAuthMessage("Account created successfully.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
      }
    } catch (error) {
      setAuthError(error.message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
  }

  const vehicleName = (id) => vehicles.find((v) => v.id === id)?.name ?? "Unknown vehicle";

  
  const enriched = documents.map((d) => {
    const days = daysLeft(d.expiry);
    const stage = days === null ? null : alertStage(days, settings.intervals);
    const key = `${d.id}:${stage}`;
    const st = alertState[key] || {};

    return {
      ...d,
      days,
      info: days === null
        ? { alert: false, cls: "warning", label: "Expiry date not entered" }
        : alertInfo(days),
      stage,
      key,
      kind: "document",
      read: !!st.read,
      resolved: !!st.resolved,
      resolvedAt: st.resolvedAt || null,
    };
  });

  const serviceAlerts = maintenance.flatMap((record) => {
    const key = `service:${record.id}:${record.nextDate || ""}:${record.nextOdometer || ""}`;
const st = alertState[key] || {};

if (record.nextServiceCompleted && !st.resolved) return [];
    const vehicle = vehicles.find(
      (v) => String(v.id) === String(record.vehicleId)
    );


    if (!vehicle) return [];

    const days = record.nextDate ? daysLeft(record.nextDate) : null;

    const dateDue = days !== null && days <= 30;

    const kmDue =
      record.nextOdometer !== "" &&
      record.nextOdometer != null &&
      vehicle.km !== "" &&
      vehicle.km != null &&
      Number.isFinite(Number(record.nextOdometer)) &&
      Number.isFinite(Number(vehicle.km)) &&
      Number(vehicle.km) >= Number(record.nextOdometer);


if (!dateDue && !kmDue && !st.resolved) return [];

    let info;

    if (dateDue && kmDue) {
      info = {
        alert: true,
        cls: "danger",
        label: "Date and kilometre target reached",
      };
    } else if (kmDue) {
      info = {
        alert: true,
        cls: "orange",
        label: "Service kilometre target reached",
      };
    } else {
      info = alertInfo(days);
    }

    return [{
      ...record,
      key,
      kind: "service",
      days,
     stage: kmDue
  ? "odometer"
  : (alertStage(days, [30, 15, 7, 3, 1]) || (st.resolved ? "resolved" : null)),
      info,
      label: record.type || "Service",
      type: record.type || "Maintenance",
      vehicleId: record.vehicleId,
      vehicleName: vehicle.name,
      date: record.nextDate || "",
      kmDue,
      dateDue,
      read: !!st.read,
      resolved: !!st.resolved,
      resolvedAt: st.resolvedAt || null,
    }];
  });

  // Recover resolved service alerts whose reminder key refers to an older
  // next-service date or odometer target. These keys remain in alertState even
  // after the maintenance record is edited, so rebuild them for history only.
  const historicalResolvedServiceAlerts = Object.entries(alertState).flatMap(
    ([key, state]) => {
      if (!key.startsWith("service:")) return [];
      if (serviceAlerts.some((alert) => alert.key === key)) return [];

      const match = /^service:(\d+):([^:]*):([^:]*)$/.exec(key);
      if (!match) return [];

      const [, recordId, historicalDate, historicalOdometer] = match;
      const record = maintenance.find((item) => String(item.id) === recordId);
      if (!record) return [];

      const vehicle = vehicles.find(
        (item) => String(item.id) === String(record.vehicleId)
      );
      if (!vehicle) return [];

      const days = historicalDate ? daysLeft(historicalDate) : null;
      const targetOdometer = historicalOdometer === ""
        ? null
        : Number(historicalOdometer);
      const kmDue =
        targetOdometer !== null &&
        Number.isFinite(targetOdometer) &&
        vehicle.km !== "" &&
        vehicle.km != null &&
        Number.isFinite(Number(vehicle.km)) &&
        Number(vehicle.km) >= targetOdometer;
      const dateDue = days !== null && days <= 30;

      return [{
        ...record,
        key,
        kind: "service",
        stage: kmDue
          ? "odometer"
          : (days === null
              ? (state.resolved ? "resolved" : "historical")
              : (alertStage(days, [30, 15, 7, 3, 1]) || (state.resolved ? "resolved" : "historical"))),
        days,
        info: !state.resolved
          ? { alert: true, cls: "warning", label: "Restored historical reminder" }
          : (days === null
              ? { alert: true, cls: "warning", label: "Historical service reminder" }
              : alertInfo(days)),
        label: `Historical ${record.type || "Service"}`,
        type: record.type || "Maintenance",
        vehicleId: record.vehicleId,
        vehicleName: vehicle.name,
        date: historicalDate || "",
        nextOdometer: targetOdometer,
        targetOdometer,
        kmDue,
        dateDue,
        read: !!state.read,
        resolved: !!state.resolved,
        resolvedAt: state.resolvedAt || null,
      }];
    }
  );

  const allAlerts = [
    ...enriched.filter((d) => d.stage !== null),
    ...serviceAlerts,
    ...historicalResolvedServiceAlerts,
  ];

  const alerts = allAlerts
  .filter((a) => !a.resolved)
  .sort((a, b) => {
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  });

  const unread = alerts.filter((a) => !a.read);

  const activeDocs = enriched.filter(
    (d) => d.days !== null && d.days >= 0
  ).length;

 function setFlag(key, patch) {
  setAlertState((s) => ({
    ...s,
    [key]: {
      ...s[key],
      ...patch,
      ...(patch.resolved === true
        ? { resolvedAt: new Date().toISOString() }
        : patch.resolved === false
          ? { resolvedAt: null }
          : {}),
    },
  }));
}

  function markAllRead() {
    setAlertState((s) => {
      const next = { ...s };
      alerts.forEach((a) => {
        next[a.key] = { ...next[a.key], read: true };
      });
      return next;
    });
  }

  // Notify once when a new document or service alert appears.
  const alertKeys = alerts.map((a) => a.key).join("|");

  useEffect(() => {
    const fresh = alerts.filter((a) => !notified.includes(a.key));
    if (!fresh.length) return;

    const items = fresh.slice(0, 3).map((a) => ({
      id: a.key,
      title: a.kind === "service"
        ? `${a.label} · ${a.vehicleName}`
        : `${docName(a)} · ${vehicleName(a.vehicleId)}`,
      body: a.kind === "service"
        ? `${a.info.label}${a.date ? ` · Due ${formatDate(a.date)}` : ""}${a.kmDue ? " · Kilometre target reached" : ""}`
        : `${a.info.label} (expiry ${formatDate(a.expiry)})`,
      cls: a.info.cls,
    }));

    if (fresh.length > 3) {
      items.push({
        id: `more-${Date.now()}`,
        title: `+${fresh.length - 3} more alerts`,
        body: "Open Alerts to see all of them.",
        cls: "info",
      });
    }

    setToasts((t) => [...t, ...items]);

    if (
      settings.browser &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      items.forEach((item) => {
        try {
          new Notification(item.title, { body: item.body });
        } catch {
          // Ignore notification errors.
        }
      });
    }

    setNotified((n) => [...n, ...fresh.map((a) => a.key)]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKeys]);

  function docStatus(vehicleId, type) {
    const list = enriched.filter(
      (d) => String(d.vehicleId) === String(vehicleId) && d.type === type
    );

    if (!list.length) return { cls: "warning", label: "Not entered" };

    const validDates = list.filter((d) => d.days !== null);

    if (!validDates.length) {
      return { cls: "warning", label: "Expiry date not entered" };
    }

    const latest = [...validDates].sort((a, b) => b.days - a.days)[0];
    return latest.info;
  }

  if (authLoading) {
    return <div className="auth-screen"><div className="auth-card"><div className="brand-icon">M</div><h1>MyGarage</h1><p>Checking your secure session…</p></div></div>;
  }

  if (!session) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={(mode) => { setAuthMode(mode); setAuthError(""); setAuthMessage(""); }}
        email={authEmail}
        setEmail={setAuthEmail}
        password={authPassword}
        setPassword={setAuthPassword}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        busy={authBusy}
        error={authError}
        message={authMessage}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  if (cloudLoading || !cloudReady) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-icon">M</div>
          <h1>Loading your garage</h1>
          <p>Securely loading your vehicles and records…</p>
          {authError && (
            <>
              <p className="auth-error">{authError}</p>
              <button className="ghost-button" onClick={handleSignOut}>Sign out</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">M</div>
          <div>
            <h2>MyGarage</h2>
            <span>VEHICLE MANAGEMENT</span>
          </div>
        </div>

        <div className="menu-label">WORKSPACE</div>

        <nav>
          {menu.map(([icon, name]) => (
            <button
              key={name}
              className={`nav-item ${active === name ? "selected" : ""}`}
              onClick={() => setActive(name)}
            >
              <span>{icon}</span>
              {name}
              {name === "Alerts" && unread.length > 0 && (
                <em className="nav-badge">{unread.length}</em>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <strong>Need assistance?</strong>
            <p>Manage all your vehicles in one place.</p>
          </div>

          <div className="profile">
            <div className="avatar">AJ</div>
            <div>
              <strong>Vehicle Owner</strong>
              <span>Personal account</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">MyGarage / {active}</div>
          <div className="topbar-right">
            <div className="bell-wrap">
              <button className="bell" onClick={() => setBellOpen((o) => !o)}>
                🔔 {unread.length > 0 && <span>{unread.length}</span>}
              </button>
              {bellOpen && (
                <div className="bell-menu">
                  <div className="bell-head">
                    <strong>Notifications</strong>
                    {unread.length > 0 && (
                      <button className="link-button" onClick={markAllRead}>
                        Mark all read
                      </button>
                    )}
                  </div>
                  {alerts.length === 0 ? (
                    <p className="bell-empty">You're all caught up.</p>
                  ) : (
                    alerts.slice(0, 5).map((a) => (
                      <div
                        key={a.key}
                        className={`bell-item ${a.read ? "" : "unread"}`}
                        onClick={() => {
                          setFlag(a.key, { read: true });
                          setBellOpen(false);
                          setActive("Alerts");
                        }}
                      >
                        <strong>
                          {a.kind === "service" ? a.label : docName(a)} · {a.vehicleName || vehicleName(a.vehicleId)}
                        </strong>
                        <span>{a.info.label}</span>
                      </div>
                    ))
                  )}
                  <button
                    className="bell-foot"
                    onClick={() => {
                      setBellOpen(false);
                      setActive("Alerts");
                    }}
                  >
                    View all alerts →
                  </button>
                </div>
              )}
            </div>
            <span className="account-email">{session.user.email}</span>
            <button className="logout-button" onClick={handleSignOut}>Sign out</button>
          </div>
        </header>

        <div className="content">
          <section className="welcome">
            <div>
              <div className="eyebrow">PERSONAL VEHICLE MANAGEMENT</div>
              <h1>{active === "Dashboard" ? "Your garage." : active}</h1>
              <p>Everything about your vehicles, all in one place.</p>
            </div>

           {active === "Dashboard" && (
  <button
    className="primary-button"
    onClick={() => setActive("My Vehicles")}
  >
    + Add vehicle
  </button>
)}
          </section>

          {active === "Dashboard" && (
            <Dashboard
              vehicles={vehicles}
              docStatus={docStatus}
              activeDocs={activeDocs}
              alerts={alerts}
              maintenance={maintenance}
              vehicleName={vehicleName}
              setActive={setActive}
            />
          )}

          {active === "My Vehicles" && (
            <Vehicles
              vehicles={vehicles}
              setVehicles={setVehicles}
              documents={documents}
              setDocuments={setDocuments}
            />
          )}

          {active === "Documents" && (
            <Documents
              vehicles={vehicles}
              enriched={enriched}
              setDocuments={setDocuments}
              vehicleName={vehicleName}
              gmailTokenStatus={gmailTokenStatus}
            />
          )}

          {active === "Maintenance" && (
            <Maintenance
              vehicles={vehicles}
              records={maintenance}
              setRecords={setMaintenance}
              vehicleName={vehicleName}
            />
          )}

          {active === "Alerts" && (
            <AlertsPage
              allAlerts={allAlerts}
              vehicleName={vehicleName}
              setFlag={setFlag}
              markAllRead={markAllRead}
              settings={settings}
              setSettings={setSettings}
              setActive={setActive}
            />
          )}

          {!["Dashboard", "My Vehicles", "Documents", "Maintenance", "Alerts"].includes(active) && (
            <div className="panel">
              <h2>{active}</h2>
              <p className="panel-subtitle">This module is coming in an upcoming step.</p>
            </div>
          )}

          <footer>MyGarage · Personal Vehicle Management · © 2026</footer>
        </div>
      </main>

      <Toasts
        toasts={toasts}
        dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        open={() => setActive("Alerts")}
      />
    </div>
  );
}

/* ---------- AUTHENTICATION ---------- */

function AuthScreen({
  mode, setMode, email, setEmail, password, setPassword,
  showPassword, setShowPassword, busy, error, message, onSubmit,
}) {
  const isSignup = mode === "signup";

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon">M</div>
          <div>
            <h1>MyGarage</h1>
            <span>PERSONAL VEHICLE MANAGEMENT</span>
          </div>
        </div>

        <div className="auth-heading">
          <p className="eyebrow">YOUR GARAGE, SECURED</p>
          <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p>{isSignup ? "Create an account to securely manage your vehicles." : "Sign in to access your vehicles and records."}</p>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Password
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "Enter your password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={6}
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}

          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "New to MyGarage?"}{" "}
          <button type="button" onClick={() => setMode(isSignup ? "login" : "signup")}>
            {isSignup ? "Sign in" : "Create an account"}
          </button>
        </p>

        <p className="auth-security">Your garage data is private to your account.</p>
      </section>
    </main>
  );
}

/* ---------- TOASTS ---------- */

function Toasts({ toasts, dismiss, open }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 9000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.cls}`}
          onClick={() => {
            dismiss(t.id);
            open();
          }}
        >
          <div>
            <strong>⚠ {t.title}</strong>
            <span>{t.body}</span>
          </div>
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- DASHBOARD ---------- */

function Dashboard({ vehicles, docStatus, activeDocs, alerts, maintenance, vehicleName, setActive }) {
  return (
    <>
      <section className="stats">
        <Stat
          label="Total vehicles"
          value={String(vehicles.length).padStart(2, "0")}
          note="Across your garage"
          icon="🚘"
        />
        <Stat
          label="Active documents"
          value={activeDocs ? String(activeDocs).padStart(2, "0") : "—"}
          note={activeDocs ? "Currently valid" : "No documents entered"}
          icon="📄"
        />
        <Stat
          label="Upcoming services"
          value={String(maintenance.filter((record) => {
            if (record.nextServiceCompleted) return false;
            const vehicle = vehicles.find((item) => item.id === record.vehicleId);
            const dateDue = record.nextDate && daysLeft(record.nextDate) <= 30;
            const kmDue =
              record.nextOdometer !== "" &&
              vehicle?.km !== "" &&
              vehicle?.km != null &&
              Number(vehicle.km) >= Number(record.nextOdometer);
            return dateDue || kmDue;
          }).length).padStart(2, "0")}
          note={
            maintenance.length
              ? "Due or scheduled within 30 days"
              : "No service records entered"
          }
          icon="🔧"
        />
        <Stat
          label="Pending alerts"
          value={String(alerts.length).padStart(2, "0")}
          note={alerts.length ? "Expiring within 30 days or expired" : "Nothing needs attention"}
          icon="⚠️"
        />
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Your vehicles</h2>
            <p>Overview of your {vehicles.length} registered vehicles</p>
          </div>
        </div>

        <div className="vehicle-grid">
          {vehicles.map((v) => {
            const ins = docStatus(v.id, "Insurance");
            const puc = docStatus(v.id, "PUC");
            return (
              <article className="vehicle-card" key={v.id}>
                <div className="vehicle-top">
                  <span className="vehicle-icon">{ICONS[v.type] || ICONS.Other}</span>
                  <span className="vehicle-type">{v.type}</span>
                </div>

                <h3>{v.name}</h3>
<p className="variant">{v.variant}</p>

{v.registrationNumber && (
  <div className="registration">
    {v.registrationNumber}
  </div>
)}

<div className="vehicle-divider" />
                <div className="vehicle-divider" />

                <div className="vehicle-details">
                  <span>Odometer</span>
                  <strong>{v.km ? `${v.km} km` : "Not entered"}</strong>
                </div>
                <div className="vehicle-details">
                  <span>Insurance</span>
                  <Status cls={ins.cls} value={ins.label} />
                </div>
                <div className="vehicle-details">
                  <span>Pollution (PUC)</span>
                  <Status cls={puc.cls} value={puc.label} />
                </div>
                <div className="vehicle-details">
                  <span>Maintenance</span>
                  <Status cls="warning" value="Not entered" />
                </div>

                <button className="view-button" onClick={() => setActive("Documents")}>
                  View documents →
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel">
          <h2>Upcoming reminders</h2>
          <p className="panel-subtitle">Things that need your attention</p>

          {alerts.length === 0 ? (
            <p className="panel-subtitle">
              No reminders yet. Add document expiry dates to start getting alerts.
            </p>
          ) : (
            <ul className="mini-alerts">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>
                      {a.type}
                      {a.type === "Other" && a.label ? ` · ${a.label}` : ""}
                    </strong>
                    <span>{vehicleName(a.vehicleId)}</span>
                  </div>
                  <Status cls={a.info.cls} value={a.info.label} />
                </li>
              ))}
            </ul>
          )}

          <button className="view-button" onClick={() => setActive("Alerts")}>
            View all alerts →
          </button>
        </div>

        <div className="panel">
          <h2>FASTag overview</h2>
          <p className="panel-subtitle">Track your toll payment accounts</p>
          <div className="balance-label">TOTAL RECORDED BALANCE</div>
          <div className="balance">₹ — — —</div>
          <p className="panel-subtitle">
            Add your FASTag details to monitor balances and recharge reminders.
          </p>
          <button className="view-button" onClick={() => setActive("FASTag")}>
            Manage FASTag →
          </button>
        </div>
      </section>
    </>
  );
}

/* ---------- VEHICLES ---------- */

const emptyVehicle = {
  name: "",
  variant: "",
  type: "Car",
  km: "",
  registrationNumber: "",
};
function Vehicles({ vehicles, setVehicles, documents, setDocuments }) {
  const [form, setForm] = useState(null); // null = closed
  const [editingId, setEditingId] = useState(null);

  function open(v) {
  setEditingId(v ? v.id : null);
  setForm(
    v
      ? {
          name: v.name,
          variant: v.variant,
          type: v.type,
          km: v.km,
          registrationNumber: v.registrationNumber || "",
        }
      : { ...emptyVehicle }
  );
}

  function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingId) {
      setVehicles(vehicles.map((v) => (v.id === editingId ? { ...v, ...form } : v)));
    } else {
      setVehicles([...vehicles, { id: Date.now(), ...form }]);
    }
    setForm(null);
    setEditingId(null);
  }

  function remove(v) {
    const count = documents.filter((d) => d.vehicleId === v.id).length;
    const msg = count
      ? `Delete ${v.name} and its ${count} document(s)?`
      : `Delete ${v.name}?`;
    if (!window.confirm(msg)) return;
    setVehicles(vehicles.filter((x) => x.id !== v.id));
    setDocuments(documents.filter((d) => d.vehicleId !== v.id));
  }

  return (
    <>
    
      <div className="toolbar">
        <p className="panel-subtitle">{vehicles.length} vehicle(s) in your garage</p>
        <button className="primary-button" onClick={() => open(null)}>
          + Add vehicle
        </button>
      </div>

      {form && (
        <form className="panel form-panel" onSubmit={save}>
          <h2>{editingId ? "Edit vehicle" : "Add vehicle"}</h2>
          <div className="form-grid">
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Honda City"
                required
              />
            </label>
            <label>
              Variant / details
              <input
                value={form.variant}
                onChange={(e) => setForm({ ...form, variant: e.target.value })}
                placeholder="e.g. 2018 · VX · Petrol"
              />
            </label>
            <label>
  Registration Number
  <input
    value={form.registrationNumber}
    onChange={(e) =>
      setForm({
        ...form,
        registrationNumber: e.target.value.toUpperCase(),
      })
    }
    placeholder="e.g. KL 45 T 2358"
  />
</label>
            <label>
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Odometer (km)
              <input
                type="number"
                min="0"
                value={form.km}
                onChange={(e) => setForm({ ...form, km: e.target.value })}
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-button">
              {editingId ? "Save changes" : "Add vehicle"}
            </button>
            <button type="button" className="ghost-button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="vehicle-grid">
        {vehicles.map((v) => (
          <article className="vehicle-card" key={v.id}>
            <div className="vehicle-top">
              <span className="vehicle-icon">{ICONS[v.type] || ICONS.Other}</span>
              <span className="vehicle-type">{v.type}</span>
            </div>
            <h3>{v.name}</h3>
            <p className="variant">{v.variant || "—"}</p>
            <p className="variant">
  {v.registrationNumber || "Registration not entered"}
</p>
            <div className="vehicle-divider" />
            <div className="vehicle-details">
              <span>Odometer</span>
              <strong>{v.km ? `${v.km} km` : "Not entered"}</strong>
            </div>
            <div className="vehicle-details">
              <span>Documents</span>
              <strong>{documents.filter((d) => d.vehicleId === v.id).length}</strong>
            </div>
            <div className="card-actions">
              <button className="view-button" onClick={() => open(v)}>
                Edit
              </button>
              <button className="view-button danger-button" onClick={() => remove(v)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------- MAINTENANCE ---------- */

const SERVICE_TYPES = ["Periodic service", "Oil change", "Brake service", "Tyre service", "Battery", "Repair", "Inspection", "Other"];

function Maintenance({ vehicles, records, setRecords, vehicleName }) {
  const blank = {
    vehicleId: vehicles[0]?.id ?? "",
    date: new Date().toISOString().slice(0, 10),
    odometer: "",
    type: "Periodic service",
    description: "",
    cost: "",
    nextDate: "",
    nextOdometer: "",
    nextServiceCompleted: false,
  };
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  



  function openAdd() {
    setEditingId(null);
    setForm({ ...blank, vehicleId: vehicles[0]?.id ?? "", date: new Date().toISOString().slice(0, 10) });
    setShowForm(true);
  }

  function openEdit(record) {
    setEditingId(record.id);
    setForm({ ...blank, ...record, vehicleId: String(record.vehicleId) });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...blank, vehicleId: vehicles[0]?.id ?? "" });
  }

  function save(e) {
    e.preventDefault();
    if (!form.vehicleId || !form.date || !form.type) return;
    if (form.odometer !== "" && Number(form.odometer) < 0) {
      window.alert("Odometer reading cannot be negative.");
      return;
    }
    if (form.cost !== "" && Number(form.cost) < 0) {
      window.alert("Service cost cannot be negative.");
      return;
    }
    if (form.nextDate && form.nextDate < form.date) {
      window.alert("Next service date cannot be earlier than this service date.");
      return;
    }
    if (form.nextOdometer && form.odometer && Number(form.nextOdometer) <= Number(form.odometer)) {
      window.alert("Next service odometer must be greater than the current reading.");
      return;
    }

    const record = {
      ...form,
      vehicleId: Number(form.vehicleId),
      odometer: form.odometer === "" ? "" : Number(form.odometer),
      cost: form.cost === "" ? "" : Number(form.cost),
      nextOdometer: form.nextOdometer === "" ? "" : Number(form.nextOdometer),
    };
    if (editingId !== null) {
      setRecords((items) => items.map((item) => item.id === editingId ? { ...item, ...record } : item));
    } else {
      setRecords((items) => [...items, { id: Date.now(), ...record }]);
    }
    closeForm();
  }

  function remove(id) {
    if (window.confirm("Delete this maintenance record?")) {
      setRecords((items) => items.filter((item) => item.id !== id));
    }
  }

  function markCompleted(record) {
  if (!window.confirm(
    `Mark the next service for ${vehicleName(record.vehicleId)} as completed?`
  )) {
    return;
  }

  setRecords((items) =>
    items.map((item) =>
      item.id === record.id
        ? { ...item, nextServiceCompleted: true }
        : item
    )
  );
}

function undoCompleted(record) {
  setRecords((items) =>
    items.map((item) =>
      item.id === record.id
        ? { ...item, nextServiceCompleted: false }
        : item
    )
  );
}

  const shown = records
  .filter((record) => filter === "all" || String(record.vehicleId) === String(filter))
  .sort((a, b) => b.date.localeCompare(a.date));
  
  const upcomingRecords = shown.filter(
    (record) =>
      !record.nextServiceCompleted &&
    (record.nextDate || record.nextOdometer !== "")
  );
  
  const completedRecords = shown.filter(
    (record) => record.nextServiceCompleted
  );
  const totalCost = shown.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
  const dueRecords = shown.filter((item) => {
    if (item.nextServiceCompleted) return false;
    const vehicle = vehicles.find(
      (v) => String(v.id) === String(item.vehicleId)
    );
    
    const dateDays = item.nextDate ? daysLeft(item.nextDate) : null;
    const dateDue = dateDays !== null && dateDays <= 30;
    const kmDue =
    item.nextOdometer !== "" &&
    vehicle?.km !== "" &&
    vehicle?.km != null &&
    Number(vehicle.km) >= Number(item.nextOdometer);
    return dateDue || kmDue;
  });
  return (
    <>
      <div className="maintenance-summary">
        <div className="panel"><span>Service records</span><strong>{shown.length}</strong></div>
        <div className="panel"><span>Recorded service spend</span><strong>₹{totalCost.toLocaleString("en-IN")}</strong></div>
        <div className="panel"><span>Upcoming / due</span><strong>{dueRecords.length}</strong></div>
      </div>

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
          <option value="all">All vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="primary-button" onClick={openAdd} disabled={!vehicles.length}>+ Add service record</button>
      </div>
      

      {showForm && (
        <form className="panel form-panel" onSubmit={save}>
          <h2>{editingId !== null ? "Edit service record" : "Add service record"}</h2>
          <div className="form-grid">
            <label>Vehicle
              <select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} required>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>Service date
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label>Odometer reading (km)
              <input type="number" min="0" step="1" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} placeholder="Enter actual reading" />
            </label>
            <label>Service type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {SERVICE_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>Service cost (₹)
              <input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="Optional" />
            </label>
            <label>Next service date
              <input type="date" min={form.date} value={form.nextDate} onChange={(e) => setForm({ ...form, nextDate: e.target.value })} />
            </label>
            <label>Next service at (km)
              <input type="number" min={form.odometer === "" ? "0" : String(Number(form.odometer) + 1)} step="1" value={form.nextOdometer} onChange={(e) => setForm({ ...form, nextOdometer: e.target.value })} placeholder="Optional" />
            </label>
            <label className="full-field">Work performed / notes
              <textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Engine oil replaced, brake pads inspected..." />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-button">{editingId !== null ? "Save changes" : "Save service"}</button>
            <button type="button" className="ghost-button" onClick={closeForm}>Cancel</button>
          </div>
        </form>
      )}

      {shown.length === 0 ? (
        <div className="panel">
          <h2>No service records yet</h2>
          <p className="panel-subtitle">Record your vehicle servicing, repairs, costs and next service schedule here. Only enter actual readings and dates.</p>
        </div>
      ) : (
        <div className="maintenance-list">
          {shown.map((record) => {
            const vehicle = vehicles.find((v) => v.id === record.vehicleId);
            const dateDays = record.nextDate ? daysLeft(record.nextDate) : null;
            const kmDue = record.nextOdometer !== "" && vehicle?.km !== "" && vehicle?.km != null && Number(vehicle.km) >= Number(record.nextOdometer);
            const dateDue = dateDays !== null && dateDays <= 30;
            return (
              <article className="panel maintenance-card" key={record.id}>
                <div className="maintenance-card-top">
                  <div><strong>{record.type}</strong><span>{vehicleName(record.vehicleId)} · {formatDate(record.date)}</span></div>
                  <div className="maintenance-card-actions">
                    {record.nextServiceCompleted ? (
                      <button className="ghost-button small" onClick={() => undoCompleted(record)}>Undo completion</button>
                    ) : (
                    <button className="primary-button small" onClick={() => markCompleted(record)} disabled={!record.nextDate && record.nextOdometer === ""}>Mark as Completed</button>
                    )}
                    <button className="ghost-button small" onClick={() => openEdit(record)}>Edit</button>
                    <button className="icon-button" onClick={() => remove(record.id)} title="Delete service record">🗑</button>
                  </div>
                </div>
                <div className="maintenance-details">
                  <span>Odometer: <b>{record.odometer !== "" ? `${Number(record.odometer).toLocaleString("en-IN")} km` : "Not entered"}</b></span>
                  <span>Cost: <b>{record.cost !== "" ? `₹${Number(record.cost).toLocaleString("en-IN")}` : "Not entered"}</b></span>
                  <span>Next date: <b>{formatDate(record.nextDate)}</b></span>
                  <span>Next odometer: <b>{record.nextOdometer !== "" ? `${Number(record.nextOdometer).toLocaleString("en-IN")} km` : "Not entered"}</b></span>
                </div>
                {record.description && <p className="maintenance-notes">{record.description}</p>}
                {(dateDue || kmDue) && !record.nextServiceCompleted && <div className="maintenance-due">{dateDays !== null && dateDays < 0 ? `Service date overdue by ${Math.abs(dateDays)} days` : dateDue ? `Next service date ${dateDays === 0 ? "is today" : `in ${dateDays} days`}` : "Odometer service threshold reached"}</div>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- DOCUMENTS ---------- */

function Documents({ vehicles, enriched, setDocuments, vehicleName, gmailTokenStatus }) {
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailStatusLoading, setGmailStatusLoading] = useState(true);
  const [gmailAccountEmail, setGmailAccountEmail] = useState("");
  const [gmailMessage, setGmailMessage] = useState("");
  const [currentUserId, setCurrentUserId] = useState(null);
  const [versionHistory, setVersionHistory] = useState([]);
  const [historyDocument, setHistoryDocument] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  
const [gmailScanning, setGmailScanning] = useState(false);
const [gmailCandidates, setGmailCandidates] = useState([]);
const [gmailScanError, setGmailScanError] = useState("");

const [gmailDownloading, setGmailDownloading] = useState("");

const [gmailAutoReviewing, setGmailAutoReviewing] = useState(false);
const [gmailReviewResults, setGmailReviewResults] = useState([]);






async function loadVersionHistory(doc) {
  if (!currentUserId) {
    window.alert("Please sign in to view document history.");
    return;
  }

  setHistoryDocument(doc);
  setHistoryLoading(true);
  setVersionHistory([]);

  try {
    const { data, error } = await supabase
      .from("document_versions")
      .select("*")
      .eq("user_id", currentUserId)
      .eq("document_id", String(doc.id))
      .order("recorded_at", { ascending: false });

    if (error) throw error;

    setVersionHistory(data || []);
  } catch (error) {
    console.error("Version history loading failed:", error);
    window.alert("Could not load version history: " + error.message);
    setHistoryDocument(null);
  } finally {
    setHistoryLoading(false);
  }
}

  async function viewDocument(doc) {
  if (!doc.filePath) {
    window.alert("No PDF is attached to this document.");
    return;
  }

  try {
    const { data, error } = await supabase.storage
      .from("vehicle-documents")
      .createSignedUrl(doc.filePath, 300);

    if (error) throw error;

    const pdfWindow = window.open("about:blank", "_blank");

if (pdfWindow) {
  pdfWindow.opener = null;
  pdfWindow.location.href = data.signedUrl;
}
  } catch (error) {
    console.error("Could not open document:", error);
    window.alert("Could not open the PDF: " + error.message);
  }
}

  useEffect(() => {
  let active = true;

  async function loadUser() {
    const { data, error } = await supabase.auth.getUser();

    if (!error && active) {
      setCurrentUserId(data.user?.id ?? null);
    }
  }

  loadUser();

  return () => {
    active = false;
  };
}, []);

  useEffect(() => {
    let mounted = true;

    async function checkGmailConnection() {
      try {
        const { data, error } = await supabase.auth.getUserIdentities();
        if (!mounted) return;

        if (error) throw error;

        const googleIdentity = (data?.identities ?? []).find(
          (identity) => identity.provider === "google"
        );
        setGmailConnected(Boolean(googleIdentity));
        setGmailAccountEmail(googleIdentity?.identity_data?.email || "");
        setGmailMessage("");
      } catch (error) {
        if (mounted) setGmailMessage(error.message || "Could not check Gmail connection.");
      } finally {
        if (mounted) setGmailStatusLoading(false);
      }
    }

    checkGmailConnection();
    return () => {
      mounted = false;
    };
  }, []);

  
async function startGoogleLink() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      redirectTo: window.location.origin,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw error;
}

  
async function connectGmail() {
  setGmailConnecting(true);
  setGmailMessage("");

  try {
    await startGoogleLink();
  } catch (error) {
    setGmailMessage(
      error.message || "Could not start Gmail connection."
    );
    setGmailConnecting(false);
  }
}


  async function reconnectGmail() {
    const confirmed = window.confirm(
      "Reconnect Gmail? This will unlink the current Google identity from MyGarage and immediately start linking it again. Your email/password sign-in will remain connected."
    );
    if (!confirmed) return;

    setGmailConnecting(true);
    setGmailMessage("");

    try {
      const { data, error: identitiesError } = await supabase.auth.getUserIdentities();
      if (identitiesError) throw identitiesError;

      const identities = data?.identities ?? [];
      const googleIdentity = identities.find(
        (identity) => identity.provider === "google"
      );

      if (googleIdentity) {
        if (identities.length < 2) {
          throw new Error(
            "Google cannot be safely unlinked because this account does not have another sign-in identity."
          );
        }

        const { error: unlinkError } = await supabase.auth.unlinkIdentity(googleIdentity);
        if (unlinkError) throw unlinkError;
      }

      await startGoogleLink();
    } catch (error) {
      setGmailMessage(
        error.message || "Could not reconnect Gmail. Your email/password sign-in remains available."
      );
      setGmailConnecting(false);
    }
  }
  

async function scanGmailDocuments() {
  setGmailScanning(true);
  setGmailScanError("");
  setGmailCandidates([]);
  setGmailReviewResults([]);

  try {
    const { data, error } = await supabase.functions.invoke(
      "scan-gmail-documents",
      { body: {} }
    );

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || "Gmail scan failed.");
    }

    const candidates = data.candidates || [];

    setGmailCandidates(candidates);

    // Automatically download and analyse the detected PDF attachments.
    await automaticallyReviewGmail(candidates);
  } catch (error) {
    console.error("Gmail automatic document scan failed:", error);
    setGmailScanError(error.message || "Could not scan Gmail.");
  } finally {
    setGmailScanning(false);
  }
}

async function reviewGmailAttachment(candidate, attachment) {
  const key = `${candidate.messageId}-${attachment.attachmentId}`;
  setGmailDownloading(key);
  setPdfError("");

  try {
    const downloadStartTime = performance.now();
    const { data, error } = await supabase.functions.invoke(
      "download-gmail-attachment",
      {
        body: {
          messageId: candidate.messageId,
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
        },
      }
    );
    console.log(
  `PDF DOWNLOAD: ${attachment.filename} — ${(
    (performance.now() - downloadStartTime) / 1000
  ).toFixed(2)} seconds`
);

    if (error) throw error;
    if (!data?.success || !data?.base64) {
      throw new Error(data?.error || "Could not download this PDF.");
    }

    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const file = new File(
      [bytes],
      data.filename || attachment.filename,
      { type: "application/pdf" }
    );

    await handlePdfSelect({
      target: {
        files: [file],
        value: "",
      },
    });
  } catch (error) {
    console.error("Gmail PDF review failed:", error);
    setPdfError(error.message || "Could not review this Gmail attachment.");
  } finally {
    setGmailDownloading("");
  }
}

async function saveGmailDocument(result) {
  if (!currentUserId) {
    throw new Error("Please sign in before saving documents.");
  }

  const detected = result.detected;
  const vehicleId = String(detected.vehicleId);

  const existingDocument = enriched.find(
    (doc) =>
      String(doc.vehicleId) === vehicleId &&
      doc.type === detected.type
  );

  const documentId = existingDocument?.id ?? Date.now().toString();

  const safeFileName = result.file.name.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const filePath =
    `${currentUserId}/${vehicleId}/${documentId}/` +
    `${Date.now()}-${safeFileName}`;

  let uploadedPath = null;

  try {
    // Upload the PDF.
    const { error: uploadError } = await supabase.storage
      .from("vehicle-documents")
      .upload(filePath, result.file, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    uploadedPath = filePath;

    // Update or create the main document record.
    const { error: documentError } = await supabase
      .from("documents")
      .upsert(
        {
          id: String(documentId),
          user_id: currentUserId,
          vehicle_id: vehicleId,
          type: detected.type,
          label: detected.label || detected.type,
          number: detected.number || null,
          issue: detected.issue || null,
          expiry: detected.expiry,
          file_path: filePath,
          file_name: result.file.name,
          file_mime_type: "application/pdf",
          file_size: result.file.size,
          source: "pdf_import",
        },
        { onConflict: "id" }
      );

    if (documentError) throw documentError;

    // Record this PDF as a document version.
    const { error: versionError } = await supabase
      .from("document_versions")
      .insert({
        user_id: currentUserId,
        document_id: String(documentId),
        type: detected.type,
        number: detected.number || null,
        issue: detected.issue || null,
        expiry: detected.expiry,
        file_path: filePath,
        file_name: result.file.name,
        file_mime_type: "application/pdf",
        file_size: result.file.size,
        source: "pdf_import",
      });

    if (versionError) throw versionError;

    // Update the application immediately.
    const record = {
      id: documentId,
      vehicleId: Number(vehicleId),
      type: detected.type,
      label: detected.label || detected.type,
      number: detected.number || "",
      issue: detected.issue || "",
      expiry: detected.expiry,
      filePath,
      fileName: result.file.name,
      fileMimeType: "application/pdf",
      fileSize: result.file.size,
      source: "pdf_import",
    };

    setDocuments((docs) => {
      const exists = docs.some(
        (doc) => String(doc.id) === String(documentId)
      );

      return exists
        ? docs.map((doc) =>
            String(doc.id) === String(documentId)
              ? { ...doc, ...record }
              : doc
          )
        : [...docs, record];
    });

    return record;
  } catch (error) {
    if (uploadedPath) {
      await supabase.storage
        .from("vehicle-documents")
        .remove([uploadedPath]);
    }

    throw error;
  }
}



async function automaticallyReviewGmail(candidates = gmailCandidates) {
  setGmailAutoReviewing(true);
  setGmailReviewResults([]);
  setGmailScanError("");

  const results = [];

  // Reuse one OCR worker throughout this Gmail scan.
  let gmailOcrWorker = null;

  const getGmailOcrWorker = async () => {
    if (!gmailOcrWorker) {
      gmailOcrWorker = await createWorker("eng");
    }

    return gmailOcrWorker;
  };

  try {
    const attachments = candidates
      .flatMap((candidate) =>
        (candidate.pdfAttachments || []).map((attachment) => ({
          candidate,
          attachment,
        }))
      )
      .slice(0, 20);

    // Step 1: Download and analyse PDFs.
    for (const { candidate, attachment } of attachments) {
      try {
        const { data, error } = await supabase.functions.invoke(
          "download-gmail-attachment",
          {
            body: {
              messageId: candidate.messageId,
              attachmentId: attachment.attachmentId,
              filename: attachment.filename,
            },
          }
        );

        if (error) throw error;

        if (!data?.success || !data?.base64) {
          throw new Error(data?.error || "Download failed.");
        }

        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const file = new File(
          [bytes],
          data.filename || attachment.filename,
          { type: "application/pdf" }
        );

        if (file.size > 10 * 1024 * 1024) {
          throw new Error("PDF exceeds the 10 MB limit.");
        }

        // Reuse the same OCR worker across PDFs.
       const pdfStartTime = performance.now();

const extractedText = await extractPdfTextWithOCR(
  bytes,
  getGmailOcrWorker
);

console.log(
  `PDF PROCESSING: ${file.name} — ${(
    (performance.now() - pdfStartTime) / 1000
  ).toFixed(2)} seconds`
);
        if (!extractedText.trim()) {
          throw new Error(
            "Could not extract text using PDF.js or OCR. The PDF may be unreadable."
          );
        }

        const detected = detectDocumentDetails(
          extractedText,
          file.name
        );

        console.log("GMAIL EXTRACTED TEXT:", extractedText);
        console.log("GMAIL DETECTED DETAILS:", detected);

        const supportedTypes = [
          "Insurance",
          "PUC",
          "RC",
          "Fitness",
          "Driving Licence",
          "Tax",
          "Permit",
        ];

        let status = "needs-review";
        let reason = "Vehicle registration could not be confidently matched.";

        if (!supportedTypes.includes(detected.type)) {
          status = "rejected";
          reason = "Not a supported vehicle document.";
        } else if (detected.matchStatus === "registration") {
          status = "matched";
          reason = "Document type and vehicle registration matched.";
        } else if (detected.matchStatus === "registration-not-found") {
          status = "unmatched";
          reason = "Valid vehicle document recognized, but this vehicle is not in MyGarage.";
        } else if (detected.matchStatus === "ambiguous") {
          status = "needs-review";
          reason = "Multiple possible vehicle matches found.";
        } else if (detected.matchStatus === "name") {
          status = "needs-review";
          reason = "Vehicle identified by name only. Registration could not be verified.";
        }

        results.push({
          messageId: candidate.messageId,
          attachmentId: attachment.attachmentId,
          filename: file.name,
          subject: candidate.subject || "",
          from: candidate.from || "",
          size: file.size,
          type: detected.type,
          registration: detected.registration,
          vehicleId: detected.vehicleId,
          number: detected.number,
          issue: detected.issue,
          expiry: detected.expiry,
          status,
          reason,
          file,
          extractedText,
          detected,
        });
      } catch (error) {
        results.push({
          messageId: candidate.messageId,
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          status: "error",
          reason: error.message || "Could not review this PDF.",
        });
      }

      setGmailReviewResults([...results]);
    }

    // Step 2: Automatically save confidently matched documents.
    for (const result of results) {
      if (result.status !== "matched" || !result.file) {
        continue;
      }

      const detected = result.detected;

      if (
        !detected.vehicleId ||
        !detected.type ||
        detected.type === "Other"
      ) {
        continue;
      }

      if (
        detected.issue &&
        detected.expiry &&
        detected.issue > detected.expiry
      ) {
        result.status = "rejected";
        result.reason = "Issue date is later than expiry date.";
        continue;
      }

      try {
        await saveGmailDocument(result);

        result.status = "saved";
        result.reason = "Automatically saved to MyGarage.";
      } catch (error) {
        console.error("Gmail document save failed:", error);

        result.status = "error";
        result.reason = error.message || "Could not save document.";
      }

      setGmailReviewResults([...results]);
    }
  } catch (error) {
    console.error("Automatic Gmail review failed:", error);
    setGmailScanError(error.message || "Automatic review failed.");
  } finally {
    // Terminate the shared worker once, after the entire scan.
    try {
      if (gmailOcrWorker) {
        await gmailOcrWorker.terminate();
        gmailOcrWorker = null;
      }
    } catch (workerError) {
      console.error("OCR worker cleanup failed:", workerError);
    }

    setGmailAutoReviewing(false);
  }
}


  const blank = { vehicleId: vehicles[0]?.id ?? "", type: "Insurance", label: "", number: "", issue: "", expiry: "" };
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
  if (showForm) {
    window.document
      .getElementById("document-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}, [showForm]);
  const [pdfBusy, setPdfBusy] = useState(false);
const [pdfText, setPdfText] = useState("");
const [pdfFile, setPdfFile] = useState(null);
const [pdfError, setPdfError] = useState("");
const [pdfDetectedRegistration, setPdfDetectedRegistration] = useState("");


async function handlePdfSelect(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;

  setPdfError("");
  setPdfText("");
  setPdfFile(null);
  setPdfDetectedRegistration("");

  if (file.type !== "application/pdf") {
    setPdfError("Please select a PDF file.");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setPdfError("PDF must be smaller than 10 MB.");
    return;
  }

  setPdfBusy(true);

  try {
    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
    }).promise;

    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      pages.push(
        content.items.map((item) => item.str || "").join(" ")
      );
    }

    const extractedText = pages.join("\n\n");

    if (!extractedText.trim()) {
      throw new Error("No selectable text found. This PDF may be scanned.");
    }

    // Detect document information
    const detected = detectDocumentDetails(extractedText, file.name);
const { registration, matchStatus, ...documentFields } = detected;

if (!documentFields.vehicleId) {
  setPdfDetectedRegistration(registration);
  setPdfFile(file);
  setPdfText(extractedText.slice(0, 30000));
  setPdfError(
    matchStatus === "registration-not-found"
      ? "The registration number was found, but it does not match any saved vehicle. Please select the correct vehicle manually."
      : "Could not confidently identify the vehicle. Please select it manually."
  );
  return;
}
    // Update the PDF preview and document form
    setPdfFile(file);
    setPdfText(extractedText.slice(0, 30000));
    setPdfDetectedRegistration(registration);
   const matchingDocuments = enriched.filter(
  (doc) =>
    String(doc.vehicleId) === String(documentFields.vehicleId) &&
    doc.type === documentFields.type
);

const existingDocument = matchingDocuments.sort(
  (a, b) => new Date(b.expiry || 0) - new Date(a.expiry || 0)
)[0];

setForm({
  ...blank,
  ...documentFields,
  label: existingDocument?.label || documentFields.label || "",
});

setEditingId(existingDocument?.id ?? null);
setShowForm(true);

  } catch (error) {
    console.error("PDF processing error:", error);
    setPdfError(error.message || "Could not read this PDF.");
  } finally {
    setPdfBusy(false);
  }
}





function detectDocumentDetails(text, fileName = "") {
  const content = String(text || "");
  const upper = content.toUpperCase();

  const normalizeRegistration = (value) =>
    String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const compactText = normalizeRegistration(content);

  function getDate(value) {
    if (!value) return "";

    const match = String(value).match(
      /(\d{2})[/-](\d{2})[/-](\d{4})/
    );

    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }

    const iso = String(value).match(
      /(\d{4})-(\d{2})-(\d{2})/
    );

    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
  }

  // Correct common OCR mistakes in registration numbers.
  function correctRegistrationOCR(value) {
    let reg = normalizeRegistration(value);

    // Example: KL01AWD025 -> KL01AW0025
    // D is a common OCR misreading of 0.
    const ambiguousMatch = reg.match(
      /^([A-Z]{2}\d{2})([A-Z]{2})[DOQ](\d{3})$/
    );

    if (ambiguousMatch) {
      reg =
        ambiguousMatch[1] +
        ambiguousMatch[2] +
        "0" +
        ambiguousMatch[3];
    }

    return reg;
  }

  // Document classification using multiple OCR indicators.
  const has = (pattern) => pattern.test(upper);

  const rcIndicators = [
    /INDIAN UNION/,
    /VEHICLE REGISTRATION/,
    /REGN\s*NO/,
    /DATE OF REGN/,
    /CHASSIS\s*(NO|NUMBER)/,
    /ENGINE\s*(\/MOTOR)?\s*(NO|NUMBER)/,
    /OWNER NAME/,
    /TRANSPORT DEPARTMENT/,
  ];

  const rcEvidence = rcIndicators.filter((pattern) =>
    pattern.test(upper)
  ).length;

  const isRC =
    has(/CERTIFICATE OF REGISTRATION/) ||
    has(/REGISTRATION CERTIFICATE/) ||
    has(/VEHICLE REGISTRATION/) ||
    rcEvidence >= 3;

  const isPUC =
    has(/\bPUC\b/) ||
    has(/POLLUTION UNDER CONTROL/) ||
    has(/POLLUTION CERTIFICATE/) ||
    has(/EMISSION TEST CERTIFICATE/);
    console.log("INSURANCE KEYWORD CHECK:", {
  insurance: has(/INSURANCE/),
  policy: has(/POLICY/),
  premium: has(/PREMIUM/),
  period: has(/PERIOD OF INSURANCE/),
  motor: has(/MOTOR/),
  vehicle: has(/VEHICLE/),
  chassis: has(/CHASSIS/),
});
const isInsurance =
  has(/CERTIFICATE OF INSURANCE/) ||
  has(/MOTOR INSURANCE POLICY/) ||
  has(/MOTOR PACKAGE POLICY/) ||
  has(/PERIOD OF INSURANCE/) ||
  has(/INSURANCE PERIOD/) ||
  (
    has(/\bINSURANCE\b/) &&
    (
      has(/\bPOLICY\b/) ||
      has(/\bPREMIUM\b/) ||
      has(/PERIOD OF INSURANCE/)
    )
  ) ||
  (
    has(/\bPOLICY\b/) &&
    has(/\bPREMIUM\b/) &&
    has(/\bVEHICLE\b/)
  );
  console.log("INSURANCE CLASSIFICATION:", isInsurance);
  const isFitness =
    has(/CERTIFICATE OF FITNESS/) ||
    has(/FITNESS CERTIFICATE/);

  const isDrivingLicence =
    has(/DRIVING LICENCE/) ||
    has(/DRIVING LICENSE/);

  const isTax =
    has(/MOTOR VEHICLE TAX/) ||
    has(/MOTOR VEHICLES TAX/) ||
    has(/TAX PAYMENT RECEIPT/);

  const isPermit =
    has(/TRANSPORT PERMIT/) ||
    has(/GOODS CARRIAGE PERMIT/) ||
    has(/CONTRACT CARRIAGE PERMIT/);

  const detectedTypes = [
    isPUC && "PUC",
    isInsurance && "Insurance",
    isRC && "RC",
    isFitness && "Fitness",
    isDrivingLicence && "Driving Licence",
    isTax && "Tax",
    isPermit && "Permit",
  ].filter(Boolean);

  const type =
  isInsurance
    ? "Insurance"
    : isPUC
    ? "PUC"
    : isRC
    ? "RC"
    : isFitness
    ? "Fitness"
    : isDrivingLicence
    ? "Driving Licence"
    : isTax
    ? "Tax"
    : isPermit
    ? "Permit"
    : "Other";

  // Extract registration from the text, including OCR variations.
  let registration = "";

 


  // Extract the registration number from the complete OCR text.
  // OCR may place the value below the table headings.
  const registrationPattern =
    /\b[A-Z]{2}\s*[0-9OQD]{1,2}\s*[A-Z]{1,3}\s*[0-9DOQ]{3,4}\b/g;

  const registrationCandidates = [
  ...(upper.match(registrationPattern) || []),
  ...(String(fileName).toUpperCase().match(registrationPattern) || []),
];

  for (const candidate of registrationCandidates) {
    let normalizedCandidate = normalizeRegistration(candidate);

    // Correct the known OCR errors in this RC.
    if (/^KL[OQ]1AWD025$/.test(normalizedCandidate)) {
      normalizedCandidate = "KL01AW0025";
    } else {
      normalizedCandidate = correctRegistrationOCR(normalizedCandidate);
    }

    if (/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(normalizedCandidate)) {
      registration = normalizedCandidate;
      break;
    }
  }

console.log("GARAGE VEHICLE MATCH DEBUG:", {
  vehiclesCount: vehicles.length,
  vehicles: vehicles.map((v) => ({
    id: v.id,
    name: v.name,
    registrationNumber: v.registrationNumber,
    registration: v.registration,
  })),
  extractedRegistration: registration,
});
  // Match against vehicles currently saved in MyGarage.
  const registrationMatches = vehicles.filter((vehicle) => {
    const savedRegistration = normalizeRegistration(
      vehicle.registrationNumber || vehicle.registration
    );

    return (
      savedRegistration.length >= 8 &&
      savedRegistration === registration
    );
  });

  let vehicle = null;
  let matchStatus = "unmatched";

  if (registrationMatches.length === 1) {
    vehicle = registrationMatches[0];
    registration =
      vehicle.registrationNumber || vehicle.registration;
    matchStatus = "registration";
  } else if (registrationMatches.length > 1) {
    matchStatus = "ambiguous";
  } else if (registration) {
    matchStatus = "registration-not-found";
  }

  // Vehicle-name fallback.
  if (!vehicle && matchStatus === "unmatched") {
    const vehicleHints = [
      { words: ["THUNDERBIRD", "ROYAL ENFIELD"], name: "Thunderbird" },
      { words: ["ACTIVA"], name: "Activa" },
      { words: ["DIO"], name: "Dio" },
      { words: ["A-STAR", "A STAR"], name: "A-Star" },
      { words: ["AMAZE"], name: "Amaze" },
    ];

    const detected = vehicleHints.find((item) =>
      item.words.some((word) => upper.includes(word))
    );

    if (detected) {
      const matches = vehicles.filter((v) =>
        v.name?.toUpperCase().includes(detected.name.toUpperCase())
      );

      if (matches.length === 1) {
        vehicle = matches[0];
        matchStatus = "name";
      } else if (matches.length > 1) {
        matchStatus = "ambiguous";
      }
    }
  }

  // Document numbers and dates.
  const policyNumber =
    upper.match(
      /\bPOLICY\s*(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9/-]+)/
    )?.[1] || "";

  const certificateNumber =
    upper.match(
      /\bCERTIFICATE\s*(?:(?:SERIAL|SR)\s*)?(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9/-]+)/
    )?.[1] || "";

  const insurancePeriod = upper.match(
    /PERIOD OF INSURANCE[\s\S]{0,150}?FROM[\s\S]{0,50}?(\d{2}[/-]\d{2}[/-]\d{4})[\s\S]{0,150}?TO[\s\S]{0,50}?(\d{2}[/-]\d{2}[/-]\d{4})/i
  );

  const issueDate =
    upper.match(
      /(?:DATE OF ISSUE|ISSUE DATE|RECEIPT DATE)\s*[:.]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i
    ) ||
    upper.match(
      /\bDATE\s*[:.]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i
    );

  const expiryDate = upper.match(
    /(?:INSURANCE EXPIRY DATE|EXPIRY DATE|VALIDITY\s*UPTO|VALID\s*UPTO|VALID\s*UP\s*TO)\s*[:.]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i
  );

  return {
    type,
    number:
      type === "PUC"
        ? certificateNumber
        : policyNumber || certificateNumber,
    issue:
      getDate(insurancePeriod?.[1]) ||
      getDate(issueDate?.[1]),
    expiry:
      getDate(insurancePeriod?.[2]) ||
      getDate(expiryDate?.[1]),
    vehicleId: vehicle ? String(vehicle.id) : "",
    registration,
    matchStatus,
  };
}



async function extractPdfTextWithOCR(pdfData, getOcrWorker) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfData),
  }).promise;

  let extractedText = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    extractedText +=
      content.items.map((item) => item.str || "").join(" ") + "\n";
  }

  const hasRegistration =
    /\b[A-Z]{2}\s*-?\s*\d{1,2}\s*-?\s*[A-Z]{1,3}\s*-?\s*\d{1,4}\b/i.test(
      extractedText
    );

  if (extractedText.trim().length >= 80 && hasRegistration) {
    return extractedText;
  }

  const worker = await getOcrWorker();
  let ocrText = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    try {
      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const result = await worker.recognize(canvas);
      ocrText += result.data.text + "\n";
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return ocrText.trim() ? ocrText : extractedText;
}


  function openAddForm() {
    setEditingId(null);
    setForm({ ...blank, vehicleId: vehicles[0]?.id ?? "" });
    setShowForm(true);
  }

  function openEditForm(document) {
  setEditingId(document.id);

  setForm({
    vehicleId: document.vehicleId,
    type: document.type,
    label: document.label || "",
    number: document.number || "",
    issue: document.issue || "",
    expiry: document.expiry || "",
  });

  setShowForm(true);
}

 async function save(e) {
  e.preventDefault();

  if (!form.vehicleId || !form.expiry) return;

  if (form.issue && form.issue > form.expiry) {
    window.alert("Issue date cannot be later than the expiry date.");
    return;
  }

  if (!currentUserId) {
    window.alert("Please sign in before saving a document.");
    return;
  }

  let uploadedPath = null;

  try {
    const existingDocument = enriched.find(
      (d) => String(d.id) === String(editingId)
    );

    const documentId = editingId ?? Date.now();

    let fileDetails = {
      filePath: existingDocument?.filePath || "",
      fileName: existingDocument?.fileName || "",
      fileMimeType: existingDocument?.fileMimeType || "",
      fileSize: existingDocument?.fileSize || null,
      source: existingDocument?.source || "manual",
    };

    if (pdfFile) {
      const safeFileName = pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");

      const filePath =
        `${currentUserId}/${form.vehicleId}/${documentId}/` +
        `${Date.now()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("vehicle-documents")
        .upload(filePath, pdfFile, {
          contentType: pdfFile.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      uploadedPath = filePath;

      fileDetails = {
        filePath,
        fileName: pdfFile.name,
        fileMimeType: pdfFile.type,
        fileSize: pdfFile.size,
        source: "pdf_import",
      };
const { error: documentError } = await supabase
  .from("documents")
  .upsert(
    {
      id: String(documentId),
      user_id: currentUserId,
      vehicle_id: String(form.vehicleId),
      type: form.type,
      label: form.label || null,
      number: form.number || null,
      issue: form.issue || null,
      expiry: form.expiry || null,
      file_path: filePath,
      file_name: pdfFile.name,
      file_mime_type: pdfFile.type,
      file_size: pdfFile.size,
      source: "pdf_import",
    },
    { onConflict: "id" }
  );

if (documentError) throw documentError;
      const { error: versionError } = await supabase
        .from("document_versions")
        .insert({
          user_id: currentUserId,
          document_id: String(documentId),
          type: form.type,
          number: form.number || null,
          issue: form.issue || null,
          expiry: form.expiry || null,
          file_path: filePath,
          file_name: pdfFile.name,
          file_mime_type: pdfFile.type,
          file_size: pdfFile.size,
          source: "pdf_import",
        });

      if (versionError) throw versionError;
    }

    const record = {
      ...form,
      vehicleId: Number(form.vehicleId),
      ...fileDetails,
    };

    if (editingId !== null) {
      setDocuments((docs) =>
        docs.map((d) =>
          d.id === editingId ? { ...d, ...record } : d
        )
      );
    } else {
      setDocuments((docs) => [
        ...docs,
        { id: documentId, ...record },
      ]);
    }

    setForm({ ...blank, vehicleId: vehicles[0]?.id ?? "" });
    setEditingId(null);
    setShowForm(false);
    setPdfFile(null);
    setPdfText("");
    setPdfDetectedRegistration("");
    setPdfError("");

    window.alert("Document saved successfully.");

  } catch (error) {
    console.error("Document save failed:", error);

    if (uploadedPath) {
      await supabase.storage
        .from("vehicle-documents")
        .remove([uploadedPath]);
    }

    window.alert(
      `Could not save the document: ${error.message || "Unknown error"}`
    );
  }
}

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...blank, vehicleId: vehicles[0]?.id ?? "" });
  }

  function remove(id) {
    if (window.confirm("Delete this document?")) {
      setDocuments((docs) => docs.filter((d) => d.id !== id));
    }
  }

  const shown = enriched
    .filter((d) => filter === "all" || d.vehicleId === Number(filter))
    .sort((a, b) => a.days - b.days);

  return (
    <>
    <section className="panel pdf-import-panel">
  <h2>Import a vehicle document</h2>
  <p className="panel-subtitle">
    Select an insurance, PUC or other PDF downloaded from WhatsApp Web.
  </p>

  <label className="pdf-file-label">
    {pdfBusy ? "Reading PDF..." : "Choose PDF"}
    <input
      type="file"
      accept="application/pdf,.pdf"
      onChange={handlePdfSelect}
      disabled={pdfBusy}
    />
  </label>

  {pdfError && <p className="pdf-error">{pdfError}</p>}

  {pdfText && (
    <div className="pdf-extracted">
      <strong>Extracted text</strong>
      <p className="panel-subtitle">{pdfFile?.name}</p>
      {pdfDetectedRegistration && (
  <p className="pdf-detected-registration">
    Detected registration: <strong>{pdfDetectedRegistration}</strong>
  </p>
)}
      <pre>{pdfText}</pre>
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          setPdfText("");
          setPdfFile(null);
          setPdfError("");
        }}
      >
        Clear PDF
      </button>
    </div>
  )}
</section>
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
          <option value="all">All vehicles</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          className="ghost-button"
          onClick={gmailConnected ? reconnectGmail : connectGmail}
          disabled={gmailConnecting || gmailStatusLoading}
          type="button"
        >
          {gmailConnecting
            ? "Connecting…"
            : gmailConnected
              ? "↻ Reconnect Gmail"
              : "Connect Gmail"}
        </button>
        <button
          className="primary-button"
          onClick={openAddForm}
          disabled={!vehicles.length}
        >
          + Add document
        </button>
      </div>
      <section className={`gmail-connection-card ${gmailConnected ? "is-connected" : ""}`} aria-live="polite">
        <div className="gmail-connection-icon" aria-hidden="true">
          {gmailStatusLoading ? "…" : gmailConnected ? "✓" : "✉"}
        </div>
        <div className="gmail-connection-copy">
          <strong>
            {gmailStatusLoading
              ? "Checking Gmail connection…"
              : gmailConnected
                ? "Gmail account connected"
                : "Gmail is not connected"}
          </strong>
          <span>
            {gmailStatusLoading
              ? "Checking the Google identity linked to your MyGarage account."
              : gmailConnected
                ? `${gmailAccountEmail ? `${gmailAccountEmail} · ` : ""}Google account linked successfully. Automatic email scanning is not active yet.`
                : "Connect your Google account to prepare Gmail document detection."}
          </span>
        </div>
        {!gmailStatusLoading && (
          <span className={`gmail-connection-badge ${gmailConnected ? "connected" : "not-connected"}`}>
            {gmailConnected ? "Connected" : "Not connected"}
          </span>
        )}
      </section>
      
{gmailConnected && (
  <section className="panel">
    <h3>Gmail document detection</h3>
    <p className="panel-subtitle">
      Search your Gmail for vehicle-related PDF attachments.
    </p>

    <button
      type="button"
      className="primary-button"
      onClick={scanGmailDocuments}
      disabled={gmailScanning}
    >
      {gmailScanning ? "Scanning Gmail..." : "Scan Gmail for PDFs"}
    </button>

  

    {gmailScanError && (
      <p className="pdf-error">{gmailScanError}</p>
    )}

    {gmailCandidates.map((candidate) => (
      <div className="panel" key={candidate.messageId}>
        <strong>{candidate.subject || "No subject"}</strong>
        <p className="panel-subtitle">
          {candidate.from} · {candidate.documentType}
        </p>

       
{candidate.pdfAttachments.map((attachment) => {
  const key = `${candidate.messageId}-${attachment.attachmentId}`;

  return (
    <div
      key={attachment.attachmentId}
      className="form-actions"
      style={{ justifyContent: "space-between", marginTop: 8 }}
    >
      <span>
        {attachment.filename} · {(attachment.size / 1024).toFixed(1)} KB
      </span>

      
    </div>
  );
})}

      </div>
    ))}

   
{gmailReviewResults.length > 0 && (
  <div className="panel">
    <h3>Automatic review results</h3>

    
{gmailReviewResults.map((result, index) => (
  <div
    key={`${result.messageId}-${result.attachmentId}-${index}`}
    className="form-actions"
    style={{
      justifyContent: "space-between",
      marginTop: 12,
      padding: 12,
      border: "1px solid #334155",
      borderRadius: 8,
    }}
  >
    <div>
      <strong>{result.filename}</strong>

      <p className="panel-subtitle">
        {result.type || "Unknown"} ·{" "}
        {result.registration || "Registration not identified"}
      </p>

      <p className="panel-subtitle">
        {result.reason}
      </p>

      
<strong
  style={{
    color:
      result.status === "saved"
        ? "#22c55e"
        : result.status === "unmatched"
        ? "#f59e0b"
        : result.status === "rejected" || result.status === "error"
        ? "#ef4444"
        : "#94a3b8",
  }}
>
  {result.status === "unmatched"
    ? "VEHICLE NOT IN GARAGE"
    : result.status.toUpperCase()}
</strong>

    </div>

    {result.file && (
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const url = URL.createObjectURL(result.file);
          const preview = window.open(
            url,
            "_blank",
            "noopener,noreferrer"
          );

          if (preview) {
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }
        }}
      >
        View PDF
      </button>
    )}
  </div>
))}

  </div>
)}

  </section>
)}

      {gmailMessage && <p className="panel-subtitle gmail-connection-error">{gmailMessage}</p>}
      {gmailConnected && (
        <p className="panel-subtitle" aria-live="polite">
          {gmailTokenStatus?.checked
            ? `OAuth token check: access token ${gmailTokenStatus.hasAccessToken ? "received" : "not available"}; refresh token ${gmailTokenStatus.hasRefreshToken ? "received" : "not available"}.`
            : "OAuth token check is waiting for a Google authentication callback."}
          {" "}Token values are not displayed or copied into a separate MyGarage storage location.
        </p>
      )}

      {showForm && (
<form
  id="document-editor"
  className="panel form-panel"
  onSubmit={save}
>          <h2>{editingId !== null ? "Edit document" : "Add document"}</h2>
          <div className="form-grid">
            <label>
              Vehicle
              <select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Document type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {DOC_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {form.type === "Other" && (
              <label>
                Document name
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="e.g. Road tax, Permit"
                  required
                />
              </label>
            )}
            <label>
              Policy / certificate / registration no.
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </label>
            <label>
              Issue date (optional)
              <input
                type="date"
                value={form.issue}
                onChange={(e) => setForm({ ...form, issue: e.target.value })}
              />
            </label>
            <label>
              Expiry date
              <input
                type="date"
                value={form.expiry}
                onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-button">
              {editingId !== null ? "Save changes" : "Save document"}
            </button>
            <button type="button" className="ghost-button" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {shown.length === 0 ? (
        <div className="panel">
          <h2>No documents yet</h2>
          <p className="panel-subtitle">
            Add insurance, PUC, RC and other documents with their expiry dates to start getting alerts.
          </p>
        </div>
      ) : (
        <div className="doc-list">
          {shown.map((d) => (
            <div className="doc-row panel" key={d.id}>
              <div className="doc-main">
                <strong>
                  {d.type === "Other" ? d.label || "Other" : d.type}
                </strong>
                <span>{vehicleName(d.vehicleId)}</span>
                {d.number && <span className="doc-number">{d.number}</span>}
              </div>
              <div className="doc-dates">
                <span>Issued: {formatDate(d.issue)}</span>
                <span>Expires: {formatDate(d.expiry)}</span>
              </div>
              <Status cls={d.info.cls} value={d.info.label} />
             <div className="doc-actions">
  {d.filePath && (
    <button
      type="button"
      className="ghost-button small"
      onClick={(event) => {
        event.stopPropagation();
        viewDocument(d);
      }}
    >
      View PDF
    </button>
  )}

  <button
    type="button"
    className="ghost-button small"
    onClick={(event) => {
      event.stopPropagation();
      loadVersionHistory(d);
    }}
  >
    Version History
  </button>

  <button
    type="button"
    className="ghost-button small"
    onClick={(event) => {
      event.stopPropagation();
      openEditForm(d);
    }}
  >
    Edit
  </button>

  <button
    type="button"
    className="icon-button"
    onClick={(event) => {
      event.stopPropagation();
      remove(d.id);
    }}
    title="Delete document"
  >
    🗑
  </button>
</div>
            </div>
          ))}
        </div>
      )}
      {historyDocument && (
  <div className="panel" style={{ marginTop: 20 }}>
    <div className="section-heading">
      <div>
        <h2>Document Version History</h2>
        <p className="panel-subtitle">
          {historyDocument.type} · {vehicleName(historyDocument.vehicleId)}
        </p>
      </div>

      <button
        className="ghost-button small"
        onClick={() => setHistoryDocument(null)}
      >
        Close
      </button>
    </div>

    {historyLoading ? (
      <p className="panel-subtitle">Loading document history...</p>
    ) : versionHistory.length === 0 ? (
      <p className="panel-subtitle">No previous versions recorded.</p>
    ) : (
      <div className="doc-list">
        {versionHistory.map((version) => (
          <div className="doc-row" key={version.id}>
            <div className="doc-main">
              <strong>{version.file_name || "Document version"}</strong>
              <span>Policy number: {version.number || "Not recorded"}</span>
              <span>Expiry: {formatDate(version.expiry)}</span>
              <span>
                Recorded: {formatDate(version.recorded_at?.slice(0, 10))}
              </span>
            </div>

            {version.file_path && (
              <button
                className="ghost-button small"
                onClick={async () => {
                  const { data, error } = await supabase.storage
                    .from("vehicle-documents")
                    .createSignedUrl(version.file_path, 300);

                  if (error) {
                    window.alert("Could not open PDF: " + error.message);
                    return;
                  }

                  const pdfWindow = window.open("about:blank", "_blank");
                  if (pdfWindow) {
                    pdfWindow.opener = null;
                    pdfWindow.location.href = data.signedUrl;
                  }
                }}
              >
                View PDF
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
)}
    </>
  );
}

/* ---------- ALERTS PAGE ---------- */


function AlertsPage({ allAlerts, vehicleName, setFlag, markAllRead, settings, setSettings, setActive }) {
  const [tab, setTab] = useState("active");

  const staged = allAlerts
    .filter((a) => a.stage !== null)
    .sort((a, b) => {
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });

  const active = staged.filter((a) => !a.resolved);
  const resolved = staged.filter((a) => a.resolved);
  const list = tab === "active" ? active : resolved;

  const expired = list.filter((a) => a.days !== null && a.days < 0);
  const upcoming = list.filter((a) => a.days === null || a.days >= 0);
  const unreadCount = active.filter((a) => !a.read).length;

  const perm = "Notification" in window ? Notification.permission : "unsupported";

  function toggleInterval(n) {
    const has = settings.intervals.includes(n);
    const next = has
      ? settings.intervals.filter((x) => x !== n)
      : [...settings.intervals, n];

    if (!next.length) return;
    setSettings({ ...settings, intervals: next.sort((x, y) => y - x) });
  }

  async function enableBrowser() {
    if (!("Notification" in window)) {
      window.alert("This browser does not support notifications.");
      return;
    }

    const result = await Notification.requestPermission();
    setSettings({ ...settings, browser: result === "granted" });
  }

  function renderRow(a) {
    const isService = a.kind === "service";
    const name = isService ? a.label : docName(a);
    const vehicle = a.vehicleName || vehicleName(a.vehicleId);

    let detail;

    if (isService) {
      const parts = [];

      if (a.date) {
        parts.push(`Due date: ${formatDate(a.date)}`);
      }

      if (a.kmDue) {
        parts.push(`Target: ${Number(a.targetOdometer ?? a.nextOdometer).toLocaleString("en-IN")} km`);
      }

      if (!parts.length) {
        parts.push("Service kilometre target reached");
      }

      detail = parts.join(" · ");
    } else {
      detail = `${stageLabel(a.stage)} · expiry ${formatDate(a.expiry)}`;
    }

    return (
      <div
        key={a.key}
        className={`alert-row alert-${a.info.cls} ${a.read || a.resolved ? "" : "unread"}`}
      >
        <div className="alert-text">
          <strong>
            {!a.read && !a.resolved && <i className="dot" />}
            {name} · {vehicle}
          </strong>
          <span>{detail}</span>
          {a.resolved && (
  <span>
    Resolved on: {a.resolvedAt
      ? new Date(a.resolvedAt).toLocaleString("en-IN")
      : "Date not recorded"}
  </span>
)}
        </div>

        <Status cls={a.info.cls} value={a.info.label} />

        <div className="alert-actions">
          {a.resolved ? (
            <button
              className="ghost-button small"
              onClick={() => setFlag(a.key, { resolved: false })}
            >
              Restore
            </button>
          ) : (
            <>
              {!a.read && (
                <button
                  className="ghost-button small"
                  onClick={() => setFlag(a.key, { read: true })}
                >
                  Mark read
                </button>
              )}

              <button
                className="ghost-button small"
                onClick={() => setFlag(a.key, { resolved: true, read: true })}
              >
                Resolve
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel form-panel">
        <h2>Alert settings</h2>
        <p className="panel-subtitle">
          Warn me this many days before a document expires (an alert also fires on the expiry day and after expiry):
        </p>

        <div className="chips">
          {INTERVAL_OPTIONS.map((n) => (
            <button
              key={n}
              className={`chip ${settings.intervals.includes(n) ? "on" : ""}`}
              onClick={() => toggleInterval(n)}
            >
              {n} day{n === 1 ? "" : "s"}
            </button>
          ))}
        </div>

        <div className="notify-row">
          <div>
            <strong>Browser notifications</strong>
            <span>
              {perm === "unsupported" && "Not supported in this browser."}
              {perm === "denied" && "Blocked. Allow notifications for this site in your browser settings."}
              {perm === "default" && "Show a pop-up when a new alert fires (while MyGarage is open in a tab)."}
              {perm === "granted" &&
                (settings.browser ? "On" : "Permission granted, currently switched off.")}
            </span>
          </div>

          {perm === "granted" ? (
            <button
              className="ghost-button small"
              onClick={() => setSettings({ ...settings, browser: !settings.browser })}
            >
              {settings.browser ? "Turn off" : "Turn on"}
            </button>
          ) : (
            perm === "default" && (
              <button className="primary-button" onClick={enableBrowser}>
                Enable
              </button>
            )
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          <button
            className={`tab ${tab === "active" ? "on" : ""}`}
            onClick={() => setTab("active")}
          >
            Active ({active.length})
          </button>

          <button
            className={`tab ${tab === "resolved" ? "on" : ""}`}
            onClick={() => setTab("resolved")}
          >
            Resolved ({resolved.length})
          </button>
        </div>

        {tab === "active" && unreadCount > 0 && (
          <button className="ghost-button" onClick={markAllRead}>
            Mark all read ({unreadCount})
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <h2>{tab === "active" ? "All clear" : "Nothing resolved yet"}</h2>
          <p className="panel-subtitle">
            {tab === "active"
              ? "No document or service alerts are currently due."
              : "Alerts you resolve will appear here."}
          </p>

          {tab === "active" && (
            <button className="view-button" onClick={() => setActive("Documents")}>
              Manage documents →
            </button>
          )}
        </div>
      ) : (
        <>
          {expired.length > 0 && (
            <section className="section">
              <div className="section-heading">
                <div>
                  <h2>Overdue</h2>
                  <p>{expired.length} alert(s) past their due date</p>
                </div>
              </div>

              <div className="alert-list">{expired.map(renderRow)}</div>
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="section">
              <div className="section-heading">
                <div>
                  <h2>Upcoming alerts</h2>
                  <p>Documents and services approaching their due dates or targets</p>
                </div>
              </div>

              <div className="alert-list">{upcoming.map(renderRow)}</div>
            </section>
          )}
        </>
      )}
    </>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function Stat({ label, value, note, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function Status({ value, cls = "warning" }) {
  return <span className={`status ${cls}`}>{value}</span>;
}

export default App;
