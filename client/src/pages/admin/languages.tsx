import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { adminConfirm } from "./components/AdminPrimitives";

interface Language {
  id: string;
  code: string;
  name: string;
  native_name: string;
  flag: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const DEFAULT_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", flag: "🇮🇳" },
  { code: "hi", name: "Hindi", nativeName: "हिंदी", flag: "🇮🇳" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", flag: "🇮🇳" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", flag: "🇮🇳" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", flag: "🇮🇳" },
  { code: "mr", name: "Marathi", nativeName: "मराठी", flag: "🇮🇳" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", flag: "🇮🇳" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇮🇳" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", flag: "🇮🇳" },
  { code: "ur", name: "Urdu", nativeName: "اردو", flag: "🇮🇳" },
];

function normalizeLanguages(payload: unknown): Language[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (Array.isArray(value.data)) return value.data as Language[];
    if (Array.isArray(value.languages)) return value.languages as Language[];
  }
  return [];
}

export default function LanguagesPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", nativeName: "", flag: "🌐", isActive: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", nativeName: "", flag: "", isActive: true });

  const { data: languages = [], isLoading } = useQuery<Language[]>({
    queryKey: ["/api/admin/languages"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/languages");
      const body = await response.json().catch(() => []);
      return normalizeLanguages(body);
    },
  });
  const languageRows = Array.isArray(languages) ? languages : [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/languages/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] }),
  });

  const addMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/admin/languages", {
      code: data.code,
      name: data.name,
      nativeName: data.nativeName,
      flag: data.flag,
      isActive: data.isActive,
      sortOrder: languageRows.length + 1,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      setShowAdd(false);
      setForm({ code: "", name: "", nativeName: "", flag: "🌐", isActive: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & typeof editForm) =>
      apiRequest("PATCH", `/api/admin/languages/${id}`, {
        name: data.name,
        nativeName: data.nativeName,
        flag: data.flag,
        isActive: data.isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/languages/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] }),
  });

  const activeCount = languageRows.filter((l) => l.is_active).length;
  const addedCodes = new Set(languageRows.map((l) => l.code));
  const availableToAdd = DEFAULT_LANGUAGES.filter((l) => !addedCodes.has(l.code));

  return (
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              🌐 App Languages
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage which languages are available in the JAGO customer and pilot apps.
              <span className="ml-2 font-medium text-blue-600">{activeCount} active</span>
            </p>
          </div>
          <button
            data-testid="button-add-language"
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <span>+ Add Language</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>How it works:</strong> Users and pilots can select their preferred language in the app settings.
            Toggle languages on/off here to control which ones appear in the app's language picker.
            English is always recommended to keep active as the fallback language.
          </p>
        </div>

        {/* Add Language Panel */}
        {showAdd && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Add New Language</h3>

            {/* Quick Add from common list */}
            {availableToAdd.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2 font-medium">Quick add Indian languages:</p>
                <div className="flex flex-wrap gap-2">
                  {availableToAdd.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setForm({ code: lang.code, name: lang.name, nativeName: lang.nativeName, flag: lang.flag, isActive: true })}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-medium rounded-lg hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300 transition-colors"
                    >
                      {lang.flag} {lang.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Language Code</label>
                <input
                  data-testid="input-lang-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                  placeholder="e.g. te, hi, en"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Flag Emoji</label>
                <input
                  value={form.flag}
                  onChange={(e) => setForm({ ...form, flag: e.target.value })}
                  placeholder="🇮🇳"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Language Name (English)</label>
                <input
                  data-testid="input-lang-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Telugu"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Native Name</label>
                <input
                  data-testid="input-lang-native"
                  value={form.nativeName}
                  onChange={(e) => setForm({ ...form, nativeName: e.target.value })}
                  placeholder="e.g. తెలుగు"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Active (visible in app)</span>
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                data-testid="button-save-language"
                onClick={() => addMutation.mutate(form)}
                disabled={!form.code || !form.name || !form.nativeName || addMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {addMutation.isPending ? "Adding..." : "Add Language"}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Language List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {languageRows.map((lang) => (
              <div
                key={lang.id}
                data-testid={`card-language-${lang.code}`}
                className={`bg-white dark:bg-gray-800 border rounded-xl p-4 transition-all ${
                  lang.is_active
                    ? "border-blue-200 dark:border-blue-800"
                    : "border-gray-200 dark:border-gray-700 opacity-60"
                }`}
              >
                {editingId === lang.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Native Name</label>
                        <input
                          value={editForm.nativeName}
                          onChange={(e) => setEditForm({ ...editForm, nativeName: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Flag</label>
                        <input
                          value={editForm.flag}
                          onChange={(e) => setEditForm({ ...editForm, flag: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateMutation.mutate({ id: lang.id, ...editForm })}
                        disabled={updateMutation.isPending}
                        className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{lang.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">{lang.name}</span>
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded font-mono">
                          {lang.code}
                        </span>
                        {lang.code === "en" && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold">
                            Default
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">{lang.native_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Active Toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{lang.is_active ? "Active" : "Hidden"}</span>
                        <button
                          data-testid={`toggle-language-${lang.code}`}
                          onClick={() => toggleMutation.mutate({ id: lang.id, isActive: !lang.is_active })}
                          disabled={toggleMutation.isPending || (lang.code === "en" && lang.is_active)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            lang.is_active ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
                          } ${lang.code === "en" && lang.is_active ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${lang.is_active ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                      {/* Edit */}
                      <button
                        onClick={() => {
                          setEditingId(lang.id);
                          setEditForm({ name: lang.name, nativeName: lang.native_name, flag: lang.flag, isActive: lang.is_active });
                        }}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                      >
                        ✏️
                      </button>
                      {/* Delete (not for English) */}
                      {lang.code !== "en" && (
                        <button
                          data-testid={`delete-language-${lang.code}`}
                          onClick={async () => {
                            if (await adminConfirm(`Delete ${lang.name}? This cannot be undone.`)) {
                              deleteMutation.mutate(lang.id);
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer stats */}
        {languageRows.length > 0 && (
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <span>Total: <strong className="text-gray-900 dark:text-white">{languageRows.length}</strong></span>
              <span>Active: <strong className="text-blue-600">{activeCount}</strong></span>
              <span>Hidden: <strong className="text-gray-400">{languageRows.length - activeCount}</strong></span>
            </div>
          </div>
        )}
      </div>
  );
}
