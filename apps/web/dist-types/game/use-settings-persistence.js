import { useEffect, useRef, useState } from 'react';
import { createLocalStorageAdapter } from '@tuner/persistence';
import { useUIStore } from '@tuner/ui';
/**
 * Settings persistence.
 *
 * Difficulty, graphics tier, audio levels, input settings and every
 * accessibility option are written back whenever they change and restored on
 * boot.
 *
 * This matters more than it looks. A player who needs reduced motion, larger
 * text or a left-handed touch layout should set it once — asking them to set it
 * again every session is the kind of small indignity that makes a game unusable
 * for the people those options exist to serve.
 *
 * Storage failures are swallowed deliberately: a full quota or a locked-down
 * browser must never stop the game from starting.
 */
const STORAGE_KEY = 'settings:v1';
export function useSettingsPersistence() {
    const [loaded, setLoaded] = useState(false);
    const adapter = useRef(createLocalStorageAdapter());
    const hydrating = useRef(true);
    // Restore once, before anything can overwrite it.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const raw = await adapter.current.get(STORAGE_KEY);
                if (!cancelled && raw !== null) {
                    const parsed = JSON.parse(raw);
                    const store = useUIStore.getState();
                    if (parsed.difficulty)
                        store.setDifficulty(parsed.difficulty);
                    if (parsed.graphicsTier)
                        store.setGraphicsTier(parsed.graphicsTier);
                    if (parsed.audioLevels) {
                        for (const [bus, value] of Object.entries(parsed.audioLevels)) {
                            if (typeof value === 'number') {
                                store.setAudioLevel(bus, value);
                            }
                        }
                    }
                    if (parsed.inputSettings) {
                        for (const [key, value] of Object.entries(parsed.inputSettings)) {
                            store.setInputSetting(key, value);
                        }
                    }
                    if (parsed.accessibility) {
                        for (const [key, value] of Object.entries(parsed.accessibility)) {
                            store.setAccessibility(key, value);
                        }
                    }
                }
            }
            catch {
                // A corrupt settings blob is not worth failing a boot over; defaults win.
            }
            finally {
                if (!cancelled) {
                    hydrating.current = false;
                    setLoaded(true);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    // Then write on every change, skipping the restore itself.
    useEffect(() => {
        const unsubscribe = useUIStore.subscribe((state) => {
            if (hydrating.current)
                return;
            const payload = {
                difficulty: state.difficulty,
                graphicsTier: state.graphicsTier,
                audioLevels: state.audioLevels,
                inputSettings: state.inputSettings,
                accessibility: state.accessibility,
            };
            void adapter.current.set(STORAGE_KEY, JSON.stringify(payload));
        });
        return unsubscribe;
    }, []);
    return { loaded };
}
//# sourceMappingURL=use-settings-persistence.js.map