import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://negcqsbonsdhvymfujff.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZ2Nxc2JvbnNkaHZ5bWZ1amZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTkxNDcsImV4cCI6MjA5MDM3NTE0N30.uD6byRpnau2ddx65tBhrFz_0PeUHrgFerHEBW6T87lM";
const WEBHOOK_URL = "https://your-n8n.com/webhook/new-booking";

function getParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { tenantId: p.get("tenant") || null, phone: p.get("phone") || null };
  } catch { return { tenantId: null, phone: null }; }
}

const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
async function sbGet(table, query = "") { const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers }); if (!r.ok) throw new Error(`GET ${table} failed`); return r.json(); }
async function sbPost(table, data) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(data) }); if (!r.ok) throw new Error(`POST ${table} failed`); return r.json(); }
async function sbPatch(table, id, data) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(data) }); return r.json(); }

// ═══════════════════════════════════════════════════════
// Slot generation — FIXED: checks ALL existing appointments
// against the FULL duration of the new service
// ═══════════════════════════════════════════════════════
function generateRealSlots(availability, appointments, dureeMins, days = 14) {
  const result = [];
  const now = new Date();
  const slotStep = 30;

  for (let d = 0; d < days; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dow = date.getDay();
    const avail = availability.find((a) => a.day_of_week === dow);
    if (!avail || avail.is_closed) continue;

    const [sh, sm] = avail.start_time.split(":").map(Number);
    const [eh, em] = avail.end_time.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const daySlots = [];

    for (let m = startMin; m + dureeMins <= endMin; m += slotStep) {
      const slotStart = new Date(date);
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (slotStart <= now) continue;

      // Le créneau occupe [slotStart, slotStart + dureeMins]
      const slotEnd = new Date(slotStart.getTime() + dureeMins * 60000);

      // Vérifier conflit avec TOUS les RDV existants
      // Un conflit existe si les deux plages se chevauchent
      const busy = appointments.some((appt) => {
        const apptStart = new Date(appt.scheduled_at);
        const apptDuree = appt.duree_minutes || 30;
        const apptEnd = new Date(apptStart.getTime() + apptDuree * 60000);
        // Overlap: slotStart < apptEnd AND slotEnd > apptStart
        return slotStart < apptEnd && slotEnd > apptStart;
      });

      daySlots.push({
        time: slotStart,
        hour: Math.floor(m / 60),
        minute: m % 60,
        busy,
        label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      });
    }
    if (daySlots.length > 0) result.push({ date, daySlots });
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════

function Loader() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "3px solid var(--bd)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
      <div style={{ fontSize: 14, color: "var(--t3)" }}>Chargement...</div>
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 12, padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48 }}>😕</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)" }}>Oups !</div>
      <div style={{ fontSize: 14, color: "var(--t3)", maxWidth: 300 }}>{message}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Mes RDV — visible quand le phone est dans l'URL
// ═══════════════════════════════════════════════════════
function MyAppointments({ myAppts, offers, onNewBooking, onCancel, onModify }) {
  const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const activeAppts = myAppts.filter((a) => a.status === "confirmed");
  const pastAppts = myAppts.filter((a) => a.status !== "confirmed");

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", marginBottom: 4 }}>Mes rendez-vous</div>
      <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 16 }}>Gérez vos réservations</div>

      {activeAppts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {activeAppts.map((a) => {
            const dt = new Date(a.scheduled_at);
            const svc = offers.find((o) => o.id === a.offer_id);
            return (
              <div key={a.id} style={{ background: "var(--bg)", border: "1px solid var(--bd)", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)" }}>{a.service_name}</div>
                    <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 4 }}>
                      📅 {dayNames[dt.getDay()]} {dt.getDate()}/{dt.getMonth() + 1} à {String(dt.getHours()).padStart(2, "0")}:{String(dt.getMinutes()).padStart(2, "0")}
                    </div>
                    {svc && <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2 }}>{svc.duree_minutes} min — {svc.prix} MAD</div>}
                  </div>
                  <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 8, fontWeight: 600, background: "var(--accent-light)", color: "var(--accent)" }}>
                    Confirmé
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => onModify(a)} style={{
                    flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--bd)", background: "var(--bg)",
                    color: "var(--t2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>Modifier</button>
                  <button onClick={() => onCancel(a.id)} style={{
                    flex: 1, padding: 10, borderRadius: 10, border: "1px solid #E5484D33", background: "#E5484D10",
                    color: "#E5484D", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>Annuler</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: 24, color: "var(--t3)", fontSize: 14, marginBottom: 20 }}>
          Aucun rendez-vous à venir.
        </div>
      )}

      {pastAppts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t3)", marginBottom: 8 }}>Historique</div>
          {pastAppts.slice(0, 5).map((a) => {
            const dt = new Date(a.scheduled_at);
            const statusLabels = { cancelled: "Annulé", completed: "Terminé", no_show: "Absent" };
            const statusColors = { cancelled: "#E5484D", completed: "#3B82F6", no_show: "#F5A623" };
            return (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--bd)", opacity: 0.6 }}>
                <div>
                  <div style={{ fontSize: 13, color: "var(--t2)" }}>{a.service_name}</div>
                  <div style={{ fontSize: 11, color: "var(--t3)" }}>{dt.getDate()}/{dt.getMonth() + 1}</div>
                </div>
                <span style={{ fontSize: 11, color: statusColors[a.status] || "var(--t3)" }}>{statusLabels[a.status] || a.status}</span>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={onNewBooking} style={{
        width: "100%", padding: 16, borderRadius: 14, border: "none",
        background: "var(--accent)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
      }}>
        Prendre un nouveau RDV
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Service Step
// ═══════════════════════════════════════════════════════
function ServiceStep({ services, onSelect, selectedCat, setSelectedCat }) {
  const cats = ["all", ...new Set(services.map((s) => s.categorie).filter(Boolean))];
  const catLabels = { all: "Tous", laser: "Laser", visage: "Visage", medical: "Médical", corps: "Corps", ongles: "Ongles", soin: "Soins", massage: "Massage", epilation: "Épilation" };
  const filtered = selectedCat === "all" ? services : services.filter((s) => s.categorie === selectedCat);

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", marginBottom: 4 }}>Choisissez votre soin</div>
      <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 16 }}>Sélectionnez le service qui vous intéresse</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
        {cats.map((c) => (
          <button key={c} onClick={() => setSelectedCat(c)} style={{
            padding: "7px 16px", borderRadius: 20, border: "1px solid var(--bd)", cursor: "pointer",
            fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", transition: "all .15s",
            background: selectedCat === c ? "var(--accent)" : "var(--bg)",
            color: selectedCat === c ? "#fff" : "var(--t2)",
            borderColor: selectedCat === c ? "var(--accent)" : "var(--bd)",
          }}>{catLabels[c] || c.charAt(0).toUpperCase() + c.slice(1)}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((s) => (
          <button key={s.id} onClick={() => onSelect(s)} style={{
            display: "flex", alignItems: "center", gap: 14, padding: 16,
            background: "var(--bg)", border: "1px solid var(--bd)", borderRadius: 14,
            cursor: "pointer", textAlign: "left", transition: "border-color .15s", width: "100%",
          }}
          onMouseOver={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
          onMouseOut={(e) => (e.currentTarget.style.borderColor = "var(--bd)")}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{s.service}</div>
              <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2 }}>
                {s.duree_minutes} min{s.description ? ` — ${s.description}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {s.promo ? (
                <>
                  <div style={{ fontSize: 10, color: "#fff", background: "#1D9E75", borderRadius: 6, padding: "2px 8px", marginBottom: 4, display: "inline-block" }}>{s.promo}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1D9E75" }}>{s.prix} MAD</div>
                </>
              ) : (
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t1)" }}>{s.prix} MAD</div>
              )}
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: 32, color: "var(--t3)", fontSize: 14 }}>Aucun service dans cette catégorie</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Date Step — reloads appointments for fresh conflict check
// ═══════════════════════════════════════════════════════
function DateStep({ availability, appointments, service, onSelect }) {
  const [slots, setSlots] = useState([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const monthNames = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

  useEffect(() => {
    setSlots(generateRealSlots(availability, appointments, service.duree_minutes || 30, 14));
  }, [availability, appointments, service]);

  if (slots.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--t1)" }}>Aucun créneau disponible</div>
        <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 6 }}>Veuillez réessayer plus tard.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", marginBottom: 4 }}>Quand ?</div>
      <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 16 }}>{service.service} — {service.duree_minutes} min</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
        {slots.map((day, i) => {
          const d = day.date;
          const isToday = d.toDateString() === new Date().toDateString();
          const freeCount = day.daySlots.filter((s) => !s.busy).length;
          return (
            <button key={i} onClick={() => setSelectedDay(i)} style={{
              minWidth: 60, padding: "10px 8px", borderRadius: 14, border: "1px solid var(--bd)",
              cursor: "pointer", textAlign: "center", transition: "all .15s",
              background: selectedDay === i ? "var(--accent)" : "var(--bg)",
              color: selectedDay === i ? "#fff" : "var(--t1)",
              borderColor: selectedDay === i ? "var(--accent)" : "var(--bd)",
            }}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{isToday ? "Auj." : dayNames[d.getDay()]}</div>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{d.getDate()}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{monthNames[d.getMonth()]}</div>
              <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{freeCount} dispo</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {slots[selectedDay]?.daySlots.map((s, i) => (
          <button key={i} disabled={s.busy} onClick={() => onSelect(s.time)} style={{
            padding: "14px 0", borderRadius: 12,
            border: s.busy ? "none" : "1px solid var(--bd)",
            background: s.busy ? "var(--bg2)" : "var(--bg)",
            color: s.busy ? "var(--t3)" : "var(--t1)",
            fontSize: 14, fontWeight: 600, cursor: s.busy ? "default" : "pointer",
            opacity: s.busy ? 0.35 : 1, transition: "all .15s",
            textDecoration: s.busy ? "line-through" : "none",
          }}
          onMouseOver={(e) => { if (!s.busy) e.currentTarget.style.borderColor = "var(--accent)"; }}
          onMouseOut={(e) => { if (!s.busy) e.currentTarget.style.borderColor = "var(--bd)"; }}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Info Step — only name if phone from URL
// ═══════════════════════════════════════════════════════
function InfoStep({ onSubmit, booking, tenant, submitting, userPhone }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(userPhone || "");
  const [email, setEmail] = useState("");
  const hasPhone = !!userPhone;
  const inputStyle = {
    width: "100%", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--bd)",
    background: "var(--bg)", color: "var(--t1)", fontSize: 16, outline: "none",
    fontFamily: "inherit", transition: "border-color .15s",
  };
  const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const dt = booking.date;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", marginBottom: 4 }}>Vos coordonnées</div>
      <div style={{ fontSize: 13, color: "var(--t3)", marginBottom: 16 }}>Pour confirmer votre réservation</div>
      <div style={{ background: "var(--accent-light)", borderRadius: 14, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>{booking.service.service}</div>
        <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 4 }}>
          {dayNames[dt.getDay()]} {dt.getDate()}/{dt.getMonth() + 1} à {String(dt.getHours()).padStart(2, "0")}:{String(dt.getMinutes()).padStart(2, "0")} — {booking.service.duree_minutes} min — {booking.service.prix} MAD
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--t2)", marginBottom: 6, display: "block" }}>Votre nom complet</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Laila Bennani" style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--bd)")} />
        </div>
        {!hasPhone && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--t2)", marginBottom: 6, display: "block" }}>Numéro de téléphone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" type="tel" style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--bd)")} />
          </div>
        )}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--t2)", marginBottom: 6, display: "block" }}>Email <span style={{ color: "var(--t3)", fontWeight: 400 }}>(pour vos rappels)</span></label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="laila.bennani@email.com" type="email" style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--bd)")} />
        </div>
      </div>
      <button onClick={() => onSubmit({ name, phone: hasPhone ? userPhone : phone, email })} disabled={!name || (!hasPhone && !phone) || submitting} style={{
        width: "100%", padding: 16, borderRadius: 14, border: "none", marginTop: 20,
        background: name && (hasPhone || phone) && !submitting ? "var(--accent)" : "var(--bg2)",
        color: name && (hasPhone || phone) && !submitting ? "#fff" : "var(--t3)",
        fontSize: 16, fontWeight: 700, cursor: name && (hasPhone || phone) && !submitting ? "pointer" : "default",
        transition: "all .2s",
      }}>
        {submitting ? "Réservation en cours..." : "Confirmer la réservation"}
      </button>
    </div>
  );
}

function ConfirmationStep({ booking, tenant, userPhone, onViewMyAppts }) {
  const dt = booking.date;
  const dayNames = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  return (
    <div style={{ textAlign: "center", paddingTop: 20 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: "var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 36 }}>✓</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--t1)", marginBottom: 6 }}>Réservation confirmée !</div>
      <div style={{ fontSize: 14, color: "var(--t3)", marginBottom: 24 }}>Vous recevrez une confirmation par WhatsApp</div>
      <div style={{ background: "var(--bg)", borderRadius: 16, padding: 20, textAlign: "left", border: "1px solid var(--bd)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t1)", marginBottom: 12 }}>{booking.service.service}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["📅", `${dayNames[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1} à ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`],
            ["⏱️", `${booking.service.duree_minutes} minutes`],
            ["💰", `${booking.service.prix} MAD`],
            ["📍", tenant?.adresse || ""],
          ].filter(([, t]) => t).map(([icon, text], i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{icon}</span>
              <span style={{ fontSize: 13, color: "var(--t2)" }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        {userPhone && (
          <button onClick={onViewMyAppts} style={{
            flex: 1, padding: 14, borderRadius: 12, border: "1px solid var(--bd)",
            textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--t1)",
            background: "var(--bg)", cursor: "pointer",
          }}>Mes RDV</button>
        )}
        <button onClick={() => window.location.reload()} style={{
          flex: 1, padding: 14, borderRadius: 12, border: "none",
          background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>Nouveau RDV</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Main BookingPage
// ═══════════════════════════════════════════════════════
export default function BookingPage() {
  // step: "myappts" | 0 (services) | 1 (date) | 2 (info) | 3 (confirmation)
  const [step, setStep] = useState(null);
  const [booking, setBooking] = useState({ service: null, date: null, client: null });
  const [selectedCat, setSelectedCat] = useState("all");
  const [modifyingAppt, setModifyingAppt] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [tenant, setTenant] = useState(null);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [myAppts, setMyAppts] = useState([]);

  const { tenantId, phone: userPhone } = getParams();

  // ── Reload appointments (for fresh conflict check) ──
  const reloadAppointments = useCallback(async (offersData) => {
    if (!tenantId) return [];
    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + 14);
    const apptData = await sbGet(
      "appointments",
      `tenant_id=eq.${tenantId}&status=eq.confirmed&scheduled_at=gte.${now.toISOString()}&scheduled_at=lte.${future.toISOString()}&select=*`
    );
    const svcList = offersData || services;
    const enriched = apptData.map((a) => {
      const svc = svcList.find((o) => o.id === a.offer_id);
      return { ...a, duree_minutes: svc?.duree_minutes || 30 };
    });
    setAppointments(enriched);
    return enriched;
  }, [tenantId, services]);

  // ── Load my appointments ──
  const loadMyAppts = useCallback(async () => {
    if (!tenantId || !userPhone) return;
    const data = await sbGet(
      "appointments",
      `tenant_id=eq.${tenantId}&customer_phone=eq.${encodeURIComponent(userPhone)}&select=*&order=scheduled_at.desc&limit=20`
    );
    setMyAppts(data);
  }, [tenantId, userPhone]);

  // ── Initial load ──
  useEffect(() => {
    if (!tenantId) { setError("Lien invalide — paramètre tenant manquant."); setLoading(false); return; }
    (async () => {
      try {
        const [tenantData, offersData, availData] = await Promise.all([
          sbGet("tenants", `id=eq.${tenantId}&select=*`),
          sbGet("offers", `tenant_id=eq.${tenantId}&active=eq.true&select=*&order=categorie,service`),
          sbGet("availability", `tenant_id=eq.${tenantId}&select=*&order=day_of_week`),
        ]);
        if (!tenantData.length) throw new Error("Centre introuvable");
        setTenant(tenantData[0]);
        setServices(offersData);
        setAvailability(availData);
        await reloadAppointments(offersData);

        if (userPhone) {
          await loadMyAppts();
          setStep("myappts");
        } else {
          setStep(0);
        }
      } catch (e) {
        setError(e.message || "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  // ── Cancel appointment ──
  const handleCancel = async (apptId) => {
    if (!confirm("Annuler ce rendez-vous ?")) return;
    await sbPatch("appointments", apptId, { status: "cancelled" });
    await loadMyAppts();
    await reloadAppointments();
  };

  // ── Modify appointment: cancel old + start new booking ──
  const handleModify = (appt) => {
    setModifyingAppt(appt);
    // Pre-select the same service
    const svc = services.find((s) => s.id === appt.offer_id);
    if (svc) {
      setBooking((b) => ({ ...b, service: svc }));
      setStep(1); // go directly to date selection
    } else {
      setStep(0); // go to service selection
    }
  };

  // ── Submit booking ──
  const handleSubmit = useCallback(async (client) => {
    setSubmitting(true);
    setBooking((b) => ({ ...b, client }));
    try {
      // If modifying, cancel the old one first
      if (modifyingAppt) {
        await sbPatch("appointments", modifyingAppt.id, { status: "cancelled" });
        setModifyingAppt(null);
      }

      const dt = booking.date;
      await sbPost("appointments", {
        tenant_id: tenantId,
        customer_phone: client.phone,
        customer_name: client.name,
        customer_email: client.email || null,
        offer_id: booking.service.id,
        service_name: booking.service.service,
        scheduled_at: dt.toISOString(),
        status: "confirmed",
      });

      // Webhook notification
      try {
        await fetch(tenant?.booking_url?.includes("webhook") ? tenant.booking_url : WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: client.name, phone: client.phone, service: booking.service.service,
            date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
            hour: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
            prix: booking.service.prix, duree: booking.service.duree_minutes, tenant_id: tenantId,
          }),
        });
      } catch {}

      await reloadAppointments();
      if (userPhone) await loadMyAppts();
      setStep(3);
    } catch (e) {
      alert("Erreur lors de la réservation. Veuillez réessayer.");
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }, [booking, tenantId, tenant, modifyingAppt, userPhone]);

  // ── Reload fresh appointments when entering date step ──
  const handleServiceSelect = useCallback(async (s) => {
    setBooking((b) => ({ ...b, service: s }));
    await reloadAppointments();
    setStep(1);
  }, [reloadAppointments]);

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      maxWidth: 480, margin: "0 auto", minHeight: "100vh",
      background: "var(--page-bg)", color: "var(--t1)",
    }}>
      <style>{`
        :root {
          --page-bg: #F6F5F0; --bg: #FFFFFF; --bg2: #F0EFE9; --bd: #E5E4DE;
          --t1: #1A1A18; --t2: #6B6A65; --t3: #9C9B96;
          --accent: #1D9E75; --accent-light: #E1F5EE;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --page-bg: #141413; --bg: #1E1E1C; --bg2: #2A2A27; --bd: #3A3A36;
            --t1: #E8E7E1; --t2: #9C9B96; --t3: #6B6A65;
            --accent: #5DCAA5; --accent-light: #085041;
          }
        }
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: var(--t3); }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {loading ? <Loader /> : error ? <ErrorScreen message={error} /> : (
        <>
          <div style={{ padding: "20px 20px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              {((typeof step === "number" && step > 0 && step < 3) || (step === 0 && userPhone)) && (
                <button onClick={() => {
                  if (step === 0 && userPhone) { setStep("myappts"); setModifyingAppt(null); }
                  else if (step === 1 && modifyingAppt) { setStep("myappts"); setModifyingAppt(null); }
                  else setStep(typeof step === "number" ? step - 1 : 0);
                }} style={{
                  width: 36, height: 36, borderRadius: 10, border: "1px solid var(--bd)",
                  background: "var(--bg)", cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--t2)",
                }}>←</button>
              )}
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)" }}>{tenant?.nom_centre || "Réservation"}</div>
                <div style={{ fontSize: 12, color: "var(--t3)" }}>{tenant?.adresse || ""}</div>
              </div>
            </div>
            {typeof step === "number" && step >= 0 && step < 3 && (
              <div style={{ display: "flex", gap: 4, marginTop: 16, marginBottom: 8 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    flex: 1, height: 3, borderRadius: 2,
                    background: i <= step ? "var(--accent)" : "var(--bd)",
                    transition: "background .3s",
                  }} />
                ))}
              </div>
            )}
            {modifyingAppt && typeof step === "number" && step < 3 && (
              <div style={{ background: "var(--accent-light)", borderRadius: 10, padding: "8px 12px", marginTop: 8, fontSize: 12, color: "var(--accent)" }}>
                Modification du RDV : {modifyingAppt.service_name}
              </div>
            )}
          </div>

          <div style={{ padding: "16px 20px 32px" }}>
            {step === "myappts" && (
              <MyAppointments
                myAppts={myAppts}
                offers={services}
                onNewBooking={() => setStep(0)}
                onCancel={handleCancel}
                onModify={handleModify}
              />
            )}
            {step === 0 && (
              <ServiceStep services={services} selectedCat={selectedCat} setSelectedCat={setSelectedCat}
                onSelect={handleServiceSelect} />
            )}
            {step === 1 && booking.service && (
              <DateStep availability={availability} appointments={appointments} service={booking.service}
                onSelect={(d) => { setBooking((b) => ({ ...b, date: d })); setStep(2); }} />
            )}
            {step === 2 && booking.date && (
              <InfoStep booking={booking} tenant={tenant} submitting={submitting}
                onSubmit={handleSubmit} userPhone={userPhone} />
            )}
            {step === 3 && <ConfirmationStep booking={booking} tenant={tenant} userPhone={userPhone}
              onViewMyAppts={async () => { await loadMyAppts(); setStep("myappts"); }} />}
          </div>
        </>
      )}
    </div>
  );
}
