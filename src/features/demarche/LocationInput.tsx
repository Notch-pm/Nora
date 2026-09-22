/**
 * Le lieu d'intervention (champ `location` du Socle, contrat 1.29.0) : une
 * adresse sur UNE ligne, complétée par la Base Adresse Nationale, et — dès
 * qu'une proposition est retenue — une carte où l'usager peut DÉPLACER LE
 * POINT pour désigner l'endroit exact. Un dépôt sauvage n'est pas toujours
 * « au 12 rue X » : il est « en face », « au bout du chemin », « sur le
 * parking » — et l'adresse, elle, ne bouge pas.
 *
 * Trois règles :
 *  1. **L'adresse ne bouge pas.** Déplacer le point ne réécrit jamais
 *     `address`. Retenir une autre proposition recentre la carte et remet le
 *     point sur l'adresse ; retaper du texte libre efface le point (plus de
 *     carte : sans point de référence, il n'y a rien à ajuster).
 *  2. **Le déplacement est borné** à `LOCATION_ADJUST_RADIUS_M` du point de
 *     l'adresse : un geste trop ample s'arrête sur le cercle, il n'est pas
 *     refusé (`clampToRadius`). La carte est FIXE, centrée sur l'adresse :
 *     c'est le marqueur qui bouge, pas la vue.
 *  3. **Le clavier fait tout.** Le marqueur est un bouton : flèches = 5 m,
 *     Maj + flèches = 25 m ; « Replacer sur l'adresse » annule ; la distance
 *     est annoncée aux lecteurs d'écran.
 *
 * La valeur émise est un `LocationValue` (`domain/location.ts`), auquel
 * l'écran accroche `addressPoint` — le point de l'adresse, centre du cercle,
 * que le contrat ne porte pas. `toFormData` ne laisse partir que les cinq
 * clés du contrat.
 */
import * as React from "react";
import { LOCATION_ADJUST_RADIUS_M } from "@fn/_shared/domain/formSchema.ts";
import {
  addressText,
  clampToRadius,
  distanceMeters,
  locationFromAddress,
  locationPoint,
  metersPerPixel,
  offsetMeters,
  parseLocationValue,
  type LatLon,
  type LocationValue,
} from "@fn/_shared/domain/location.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";
import { clampZoom, DEFAULT_ZOOM, markerPosition, pointAt, type MapView } from "@/lib/carto.ts";
import { TileLayer, useElementSize } from "@/components/map/TileLayer.tsx";
import type { AddressSuggestion } from "@/services/adresse/ban.ts";
import { AddressInput } from "./AddressInput.tsx";

/** Ce que l'écran retient en plus du contrat : le point de l'adresse, centre du cercle. */
export interface LocationDraft extends LocationValue {
  addressPoint?: LatLon;
}

const MAP_HEIGHT = 260;
/** Bornes du zoom de CE contrôle : de l'îlot (15) au bâtiment (19). */
const ZOOM_MIN = 15;
const ZOOM_MAX = 19;
const STEP_M = 5;
const BIG_STEP_M = 25;
/** En deçà, un déplacement n'en est pas un (bruit du pointeur). */
const MOVED_THRESHOLD_M = 1;

function readPoint(raw: unknown): LatLon | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { lat, lon } = raw as { lat?: unknown; lon?: unknown };
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon };
}

function readDraft(value: unknown): LocationDraft | null {
  const parsed = parseLocationValue(value);
  if (parsed === null) return null;
  return { ...parsed, addressPoint: readPoint((value as { addressPoint?: unknown }).addressPoint) };
}

export function LocationInput({
  id,
  value,
  onChange,
  className,
  invalid,
  describedBy,
  placeholder,
}: {
  id: string;
  value: unknown;
  onChange: (value: LocationDraft | undefined) => void;
  className: string;
  invalid: boolean;
  describedBy: string | undefined;
  placeholder?: string;
}) {
  const draft = React.useMemo(() => readDraft(value), [value]);
  // ⚠️ Ce que l'usager voit est lu DIRECTEMENT de la valeur, jamais du `draft` :
  // celui-ci passe par `parseLocationValue`, qui rogne l'adresse et rejette une
  // saisie encore blanche. S'en servir ici rendrait l'espace intapable (bug de
  // production du 2026-09-22) — un champ contrôlé ne se dérive jamais d'une
  // transformation à perte de ce qui vient d'être tapé.
  const text = addressText(value);
  const point = draft === null ? null : locationPoint(draft);
  // Le centre du cercle : le point de l'adresse, ou — état restauré sans lui —
  // le point retenu, faute de mieux.
  const center = draft?.addressPoint ?? point;

  function type(next: string) {
    // Vider le champ retire la réponse ; tout le reste est conservé tel quel,
    // espaces de bord compris (une saisie encore blanche reste affichable, et
    // ne part pas dans la demande : `parseLocationValue` la tient pour vide).
    onChange(next === "" ? undefined : locationFromAddress(next));
  }

  function choose(suggestion: AddressSuggestion) {
    const hasPoint = suggestion.lat !== null && suggestion.lon !== null;
    onChange({
      address: suggestion.label,
      lat: hasPoint ? suggestion.lat : null,
      lon: hasPoint ? suggestion.lon : null,
      precision: suggestion.precision,
      adjusted: false,
      addressPoint: hasPoint ? { lat: suggestion.lat!, lon: suggestion.lon! } : undefined,
    });
  }

  function move(next: LatLon) {
    if (draft === null || center === null) return;
    const clamped = clampToRadius(center, next, LOCATION_ADJUST_RADIUS_M);
    const adjusted = distanceMeters(center, clamped) > MOVED_THRESHOLD_M;
    onChange({
      ...draft,
      lat: adjusted ? clamped.lat : center.lat,
      lon: adjusted ? clamped.lon : center.lon,
      adjusted,
      addressPoint: center,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <AddressInput
        id={id}
        className={className}
        value={text}
        invalid={invalid}
        describedBy={describedBy}
        autoComplete="off"
        placeholder={placeholder}
        // Dans le flux : la carte suit, et une liste flottante par-dessus une
        // carte se lit mal.
        inline
        onChange={type}
        onChoose={choose}
      />
      {center !== null && point !== null && (
        <LocationMap
          inputId={id}
          center={center}
          point={point}
          adjusted={draft?.adjusted === true}
          onMove={move}
          onReset={() => move(center)}
        />
      )}
    </div>
  );
}

function LocationMap({
  inputId,
  center,
  point,
  adjusted,
  onMove,
  onReset,
}: {
  inputId: string;
  center: LatLon;
  point: LatLon;
  adjusted: boolean;
  onMove: (next: LatLon) => void;
  onReset: () => void;
}) {
  const t = useT();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM);
  const dragging = React.useRef(false);

  // Nouvelle adresse → on repart du zoom de lecture.
  React.useEffect(() => setZoom(DEFAULT_ZOOM), [center.lat, center.lon]);

  const view: MapView = { lat: center.lat, lon: center.lon, zoom: clampZoom(zoom), width, height };
  const radiusPx = LOCATION_ADJUST_RADIUS_M / metersPerPixel(center.lat, view.zoom);
  const marker = markerPosition(point, view);
  const distance = Math.round(distanceMeters(center, point));

  function pointFromEvent(event: React.PointerEvent): LatLon | null {
    const element = ref.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return pointAt({ left: event.clientX - rect.left, top: event.clientY - rect.top }, view);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? BIG_STEP_M : STEP_M;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [step, 0],
      ArrowDown: [-step, 0],
      ArrowRight: [0, step],
      ArrowLeft: [0, -step],
    };
    const delta = moves[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onMove(offsetMeters(point, delta[0], delta[1]));
  }

  const controlClass =
    "flex h-8 w-8 items-center justify-center rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white text-[color:var(--pt-ink)] shadow-sm hover:bg-[color:color-mix(in_srgb,var(--brand-primary)_10%,white)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={ref}
        role="group"
        aria-label={t("location.mapLabel")}
        style={{ height: MAP_HEIGHT }}
        className="relative overflow-hidden rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-[color:var(--pt-surface,#f3f4f6)]"
      >
        <TileLayer view={view} />

        {/* Le cercle des 150 m : là où le point peut aller. Décoratif — la borne
            est dans `clampToRadius`, pas dans le dessin. */}
        {width > 0 && height > 0 && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={width}
            height={height}
          >
            <circle
              cx={width / 2}
              cy={height / 2}
              r={radiusPx}
              fill="var(--brand-primary)"
              fillOpacity={0.08}
              stroke="var(--brand-primary)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            {/* Le point de l'adresse, petit et fixe, quand le marqueur l'a quitté. */}
            {adjusted && (
              <circle cx={width / 2} cy={height / 2} r={4} fill="var(--brand-primary)" fillOpacity={0.5} />
            )}
          </svg>
        )}

        {/* Le marqueur : un bouton, déplaçable au pointeur et au clavier. */}
        <button
          type="button"
          aria-label={t("location.markerLabel")}
          aria-describedby={inputId + "-distance"}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.preventDefault();
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const next = pointFromEvent(event);
            if (next !== null) onMove(next);
          }}
          onPointerUp={(event) => {
            dragging.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          style={{ left: marker.left, top: marker.top, touchAction: "none" }}
          className="absolute z-10 -translate-x-1/2 -translate-y-full cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] rounded-full"
        >
          <svg aria-hidden="true" width="28" height="36" viewBox="0 0 28 36">
            <path
              d="M14 1C6.8 1 1 6.7 1 13.8c0 9.6 11.6 20.1 12.1 20.5a1.3 1.3 0 0 0 1.8 0C15.4 33.9 27 23.4 27 13.8 27 6.7 21.2 1 14 1z"
              fill="var(--brand-primary)"
              stroke="white"
              strokeWidth="2"
            />
            <circle cx="14" cy="13.8" r="4.5" fill="white" />
          </svg>
        </button>

        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col gap-1">
          <button
            type="button"
            className={controlClass}
            aria-label={t("location.zoomIn")}
            disabled={view.zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 1))}
          >
            +
          </button>
          <button
            type="button"
            className={controlClass}
            aria-label={t("location.zoomOut")}
            disabled={view.zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 1))}
          >
            −
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          id={inputId + "-distance"}
          role="status"
          aria-live="polite"
          className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]"
        >
          {adjusted
            ? t("location.moved", { n: distance })
            : t("location.hint", { n: LOCATION_ADJUST_RADIUS_M })}
        </p>
        {adjusted && (
          <button
            type="button"
            onClick={onReset}
            className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] underline underline-offset-2"
          >
            {t("location.reset")}
          </button>
        )}
      </div>
    </div>
  );
}
