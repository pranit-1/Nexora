"use client";

import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, addDoc, getDoc, doc, deleteDoc } from "firebase/firestore";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Calendar,
  Plus,
  Clock,
  RefreshCw,
  Loader2,
  CalendarDays,
  Trash2,
  ExternalLink,
  Download,
  AlertCircle,
  Briefcase,
  Sparkles,
  Bookmark,
  CheckCircle2,
  X,
  Tag,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useOpportunities } from "@/hooks/useOpportunities";
import type { CalendarEvent, CalendarEventType } from "@/lib/types";

export default function CalendarPage() {
  const { currentUser } = useAuth();
  const { opportunities } = useOpportunities();
  const [customEvents, setCustomEvents] = useState<CalendarEvent[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [appliedOpps, setAppliedOpps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Form states (User Manual Entry)
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [type, setType] = useState<CalendarEventType>("reminder");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Selected date filter (clicking a date on grid)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Grid dates calculation
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  useEffect(() => {
    if (!currentUser) return;

    const loadEventsAndDeadlines = async () => {
      try {
        const list: CalendarEvent[] = [];

        // 1. Fetch user manually created custom events
        const q = query(collection(db, "calendar_events"), where("uid", "==", currentUser.uid));
        const customSnap = await getDocs(q);
        customSnap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as CalendarEvent);
        });
        setCustomEvents(list);

        // 2. Fetch bookmarks
        const bookSnap = await getDoc(doc(db, "bookmarks", currentUser.uid));
        if (bookSnap.exists()) {
          const ids: string[] = bookSnap.data().opportunityIds || [];
          setSavedIds(ids);
        } else {
          setSavedIds([]);
        }

        // 3. Fetch applications (for interview rounds)
        const appQ = query(collection(db, "applications"), where("uid", "==", currentUser.uid));
        const appSnap = await getDocs(appQ);
        const appsList: any[] = [];
        appSnap.forEach((d) => {
          appsList.push({ id: d.id, ...d.data() });
        });
        setAppliedOpps(appsList);
      } catch (err) {
        console.error("Error loading calendar data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadEventsAndDeadlines();
  }, [currentUser, syncing]);

  // Combine automatic deadlines, interview rounds, and manual custom tasks
  const events = useMemo(() => {
    const list: (CalendarEvent & { linkedUrl?: string; isManual?: boolean })[] = customEvents.map((c) => ({
      ...c,
      isManual: true,
    }));

    // Auto-feed from Bookmarked Opportunities
    savedIds.forEach((id) => {
      const opp = opportunities.find((o) => o.id === id);
      if (opp && opp.deadline) {
        list.push({
          id: `deadline_${opp.id}`,
          uid: currentUser?.uid || "",
          title: `${opp.title}`,
          date: opp.deadline,
          type: "deadline",
          description: `Application deadline for ${opp.organization} (${opp.category})`,
          linkedOpportunityId: opp.id,
          linkedUrl: `/opportunity/${opp.id}`,
          createdAt: new Date().toISOString(),
          isManual: false,
        });
      }
    });

    // Auto-feed from Applied status / interviews
    appliedOpps.forEach((app) => {
      if (app.interviewDate) {
        list.push({
          id: `interview_${app.id}`,
          uid: currentUser?.uid || "",
          title: `Interview Round: ${app.opportunityTitle || "Opportunity"}`,
          date: app.interviewDate,
          type: "interview",
          description: app.notes || "Live technical / evaluation interview",
          linkedUrl: app.applyLink || `/opportunity/${app.opportunityId}`,
          createdAt: new Date().toISOString(),
          isManual: false,
        });
      }
    });

    return list;
  }, [customEvents, savedIds, opportunities, appliedOpps, currentUser]);

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !title.trim() || !dateStr) return;

    try {
      setSubmitting(true);
      const newEvent = {
        uid: currentUser.uid,
        title: title.trim(),
        date: dateStr,
        type,
        description: desc.trim(),
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, "calendar_events"), newEvent);

      setTitle("");
      setDateStr("");
      setDesc("");
      setShowAddForm(false);
      setSyncing((s) => !s);
    } catch (err) {
      console.error("Failed to add custom event:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCustomEvent = async (id: string) => {
    if (!confirm("Are you sure you want to delete this custom event?")) return;
    try {
      await deleteDoc(doc(db, "calendar_events", id));
      setCustomEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete event:", err);
    }
  };

  // Export all calendar items to .ics format for Google / Apple / Outlook Calendar
  const exportToICS = () => {
    if (events.length === 0) {
      alert("No events to export!");
      return;
    }

    let icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NEXORA//Student Career Hub Calendar//EN",
      "CALSCALE:GREGORIAN",
    ];

    events.forEach((ev) => {
      const cleanDate = ev.date.replace(/[-]/g, "");
      icsContent.push(
        "BEGIN:VEVENT",
        `UID:${ev.id}@nexora.platform`,
        `DTSTAMP:${cleanDate}T090000Z`,
        `DTSTART;VALUE=DATE:${cleanDate}`,
        `SUMMARY:[NEXORA] ${ev.title}`,
        `DESCRIPTION:${ev.description || "NEXORA Calendar Event"}`,
        "STATUS:CONFIRMED",
        "END:VEVENT"
      );
    });

    icsContent.push("END:VCALENDAR");

    const blob = new Blob([icsContent.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute("download", `nexora_schedule_${months[currentMonth]}_${currentYear}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month: number, year: number) => {
    return new Date(year, month, 1).getDay();
  };

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Filtered list: either selected day or upcoming sorted
  const sortedUpcoming = events
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const displayedAgenda = selectedDate
    ? sortedUpcoming.filter((e) => e.date === selectedDate)
    : sortedUpcoming.filter((e) => new Date(e.date).getTime() >= new Date().setHours(0, 0, 0, 0));

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface border border-border p-6 rounded-3xl shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-primary/10 text-primary rounded-xl border border-primary/20">
              <CalendarDays className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-extrabold text-foreground">Calendar Hub</h1>
          </div>
          <p className="text-foreground-muted text-xs mt-1.5 max-w-xl">
            Auto-syncs application deadlines & interview schedules with manual entries for tests, LOR submissions, and exams.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportToICS}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-surface border border-border hover:bg-surface-raised rounded-xl text-xs font-semibold text-foreground transition-all shadow-sm"
            title="Download .ics file to import into Google Calendar or Apple Calendar"
          >
            <Download className="w-3.5 h-3.5 text-primary" />
            Export to Google Calendar (.ics)
          </button>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-semibold text-xs rounded-xl shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> New Custom Event
          </button>
        </div>
      </div>

      {/* Manual Entry Form Box (Dedicated Section) */}
      {showAddForm && (
        <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm animate-in fade-in duration-200 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 text-primary rounded-lg">
                <Tag className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-extrabold text-foreground text-sm">Add Personal Calendar Event</h3>
                <p className="text-[11px] text-foreground-muted">Add interview prep, LOR submission, exam, or project milestone.</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddForm(false)}
              className="p-1 text-foreground-muted hover:text-foreground rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleAddEvent} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Event Title</label>
              <input
                type="text"
                placeholder="e.g. Stanford LOR Submission / Mock Interview"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full text-xs p-3 bg-background border border-border rounded-xl outline-none focus:border-primary text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                required
                className="w-full text-xs p-3 bg-background border border-border rounded-xl outline-none focus:border-primary text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Event Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CalendarEventType)}
                className="w-full text-xs p-3 bg-surface-raised border border-border rounded-xl outline-none focus:border-primary text-foreground"
              >
                <option value="reminder">Personal Reminder</option>
                <option value="interview">Interview Slot</option>
                <option value="deadline">Personal Deadline</option>
                <option value="event">Workshop / Hackathon</option>
                <option value="general">Exam / Milestone</option>
              </select>
            </div>

            <div className="space-y-1 sm:col-span-3">
              <label className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">Notes / Links (Optional)</label>
              <input
                type="text"
                placeholder="Zoom / Meet link, preparation checklist, contact person"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full text-xs p-3 bg-background border border-border rounded-xl outline-none focus:border-primary text-foreground"
              />
            </div>

            <div className="flex items-end justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2.5 border border-border text-foreground rounded-xl text-xs font-semibold hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-hover shadow-sm disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save Event"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Calendar & Agenda Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Interactive Month Grid */}
        <div className="lg:col-span-2 bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-extrabold text-foreground text-lg">
                {months[currentMonth]} {currentYear}
              </h3>
              <p className="text-[11px] text-foreground-muted">
                Click any day to inspect scheduled deadlines and interviews.
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={prevMonth}
                className="p-2 border border-border rounded-xl text-xs font-bold hover:bg-surface-raised text-foreground transition-colors"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setCurrentMonth(new Date().getMonth());
                  setCurrentYear(new Date().getFullYear());
                  setSelectedDate(null);
                }}
                className="px-3 py-1.5 border border-border rounded-xl text-xs font-bold hover:bg-surface-raised text-foreground transition-colors"
              >
                Today
              </button>
              <button
                onClick={nextMonth}
                className="p-2 border border-border rounded-xl text-xs font-bold hover:bg-surface-raised text-foreground transition-colors"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Header */}
          <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-extrabold text-foreground-muted uppercase tracking-wider">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-2 text-xs">
            {/* Pad first week */}
            {[...Array(firstDay)].map((_, i) => (
              <div key={`empty-${i}`} className="h-20 border border-transparent"></div>
            ))}

            {/* Month Days */}
            {[...Array(daysInMonth)].map((_, i) => {
              const day = i + 1;
              const formattedDay = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = events.filter((e) => e.date === formattedDay);
              const isSelected = selectedDate === formattedDay;
              const isToday =
                new Date().toISOString().split("T")[0] === formattedDay;

              return (
                <button
                  key={`day-${day}`}
                  onClick={() => setSelectedDate(isSelected ? null : formattedDay)}
                  className={`h-20 border rounded-2xl p-2 flex flex-col justify-between items-start text-left group transition-all overflow-hidden relative ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : isToday
                      ? "border-primary/50 bg-surface-raised font-bold"
                      : "border-border hover:border-primary/40 hover:bg-surface-raised/40"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-[11px] font-extrabold ${isToday ? "text-primary" : "text-foreground"}`}>
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>

                  {dayEvents.length > 0 && (
                    <div className="w-full space-y-1 max-h-[36px] overflow-hidden">
                      {dayEvents.slice(0, 2).map((de) => (
                        <div
                          key={de.id}
                          className={`text-[8px] font-bold px-1.5 py-0.5 rounded truncate leading-tight uppercase ${
                            de.type === "deadline"
                              ? "bg-red-500/10 text-red-500 border border-red-500/20"
                              : de.type === "interview"
                              ? "bg-purple-500/10 text-purple-500 border border-purple-500/20"
                              : "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                          }`}
                          title={de.title}
                        >
                          {de.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[7px] text-foreground-muted font-bold text-center">
                          +{dayEvents.length - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Color Legend */}
          <div className="flex items-center gap-4 pt-3 border-t border-border text-[11px] text-foreground-muted flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span>Application Deadline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              <span>Interview Slot</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Personal Task / Exam</span>
            </div>
          </div>
        </div>

        {/* Right Sidebar Agenda & Urgency Timeline */}
        <div className="bg-surface border border-border p-6 rounded-3xl shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-extrabold text-foreground text-sm flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" />
              {selectedDate ? `Date: ${selectedDate}` : "Upcoming Timeline"}
            </h3>
            {selectedDate && (
              <button
                onClick={() => setSelectedDate(null)}
                className="text-[10px] text-primary hover:underline font-bold"
              >
                Show All
              </button>
            )}
          </div>

          <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
            {displayedAgenda.map((e) => {
              const daysLeft = Math.ceil(
                (new Date(e.date).getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
              );
              const isClosingSoon = daysLeft >= 0 && daysLeft <= 3;

              return (
                <div
                  key={e.id}
                  className="p-3.5 bg-surface-raised border border-border rounded-2xl space-y-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-extrabold px-2 py-0.5 rounded-full uppercase border ${
                        e.type === "deadline"
                          ? "bg-red-500/10 text-red-500 border-red-500/20"
                          : e.type === "interview"
                          ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
                          : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                      }`}>
                        {e.type}
                      </span>
                      {e.isManual && (
                        <span className="text-[8px] font-bold text-foreground-muted bg-surface px-1.5 py-0.5 rounded">
                          User Added
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                        isClosingSoon
                          ? "bg-red-500 text-white animate-pulse"
                          : daysLeft > 0
                          ? "bg-surface text-foreground font-semibold"
                          : "bg-surface text-foreground-muted"
                      }`}>
                        {daysLeft === 0 ? "Today" : daysLeft > 0 ? `${daysLeft}d left` : "Passed"}
                      </span>

                      {e.isManual && (
                        <button
                          onClick={() => handleDeleteCustomEvent(e.id)}
                          className="p-1 text-foreground-muted hover:text-red-500 rounded transition-colors"
                          title="Delete Custom Event"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <h5 className="font-bold text-xs text-foreground leading-snug">{e.title}</h5>
                    {e.description && (
                      <p className="text-[11px] text-foreground-muted mt-1 leading-relaxed">
                        {e.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[10px] text-foreground-muted border-t border-border/50">
                    <span className="font-semibold">
                      {new Date(e.date).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>

                    {e.linkedUrl && (
                      <Link
                        href={e.linkedUrl}
                        className="text-primary hover:underline font-bold flex items-center gap-1"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}

            {displayedAgenda.length === 0 && (
              <div className="text-center py-12">
                <Calendar className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <h5 className="font-bold text-foreground text-xs">No scheduled events</h5>
                <p className="text-foreground-muted text-[10px] mt-1 max-w-[200px] mx-auto">
                  {selectedDate
                    ? "No events on this specific date. Click 'Show All' or pick another date."
                    : "Bookmark opportunities or click '+ New Custom Event' to add entries."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
