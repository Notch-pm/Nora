/**
 * L'adresse en UNE ligne, qui propose pendant la frappe — le champ `adresse`
 * du bloc « Vos informations », porté du `AddressField` d'Iris en mode
 * `singleLine`.
 *
 * Trois règles, dans cet ordre :
 *  1. **Il propose, il ne garde pas la porte.** Retenir une proposition est
 *     facultatif : le texte tapé est conservé tel quel. La BAN ignore les
 *     adresses neuves, les lieux-dits mal nommés et tout ce qui n'est pas en
 *     France — et l'usager, lui, sait où il habite.
 *  2. **Le clavier fait tout.** ↑ ↓ pour parcourir, Entrée choisit ET NE
 *     SOUMET PAS le formulaire, Échap ferme, Tab sort.
 *  3. **Une seule clé.** Le contrat n'a que `adresse` : la proposition retenue
 *     y entre entière (« 10 Avenue de Frémeur 44000 Nantes »), comme Iris le
 *     fait sur ce même champ. Ni code postal ni ville à part — ils n'iraient
 *     nulle part.
 */
import * as React from "react";
import { useT, useTn } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { MIN_QUERY_LENGTH, suggestionContext, type AddressPrecision, type AddressSuggestion } from "@/services/adresse/ban.ts";
import { useAddressSuggestions } from "@/services/adresse/useAddressSuggestions.ts";

/** Le suffixe d'une proposition moins fine qu'une adresse — l'usager doit le voir avant de la retenir. */
const PRECISION_KEYS: Record<Exclude<AddressPrecision, "adresse">, StringKey> = {
  voie: "address.precision.voie",
  lieu_dit: "address.precision.lieu_dit",
  commune: "address.precision.commune",
};

export function AddressInput({
  id,
  value,
  onChange,
  className,
  invalid,
  describedBy,
  autoComplete,
  inline = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** La classe du champ, erreur comprise — celle de ses voisins du bloc. */
  className: string;
  invalid: boolean;
  describedBy: string | undefined;
  autoComplete: string | undefined;
  /**
   * La liste se rend DANS le flux plutôt qu'en surimpression : dans le panneau
   * de la bulle de l'assistant (`overflow-hidden`), une liste flottante serait
   * rognée. Elle pousse alors le contenu — le prix d'un conteneur étroit.
   */
  inline?: boolean;
}) {
  const t = useT();
  const tn = useTn();
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  // Après un choix, la BAN n'est plus interrogée tant que l'usager ne retape
  // pas : le libellé complet lui serait renvoyé, et la liste se rouvrirait
  // sur ce qu'il vient de choisir.
  const [chosen, setChosen] = React.useState(false);
  const listId = id + "-propositions";

  const { suggestions, loading, error, stale } = useAddressSuggestions(value, !chosen);
  const showList = open && suggestions.length > 0;

  React.useEffect(() => setIndex(0), [suggestions]);

  function choose(suggestion: AddressSuggestion) {
    setChosen(true);
    setOpen(false);
    onChange(suggestion.label);
  }

  function type(next: string) {
    setChosen(false);
    setOpen(true);
    onChange(next);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      // Tant que la liste est ouverte, Entrée CHOISIT et ne soumet pas :
      // l'inverse enverrait des formulaires à moitié écrits.
      event.preventDefault();
      const suggestion = suggestions[index];
      if (suggestion) choose(suggestion);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    // Tab n'est pas détourné : il doit continuer de sortir du champ.
  }

  const searching = !error && loading && !stale && value.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        className={className}
        value={value}
        autoComplete={autoComplete}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${index}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => type(event.target.value)}
        onFocus={() => setOpen(true)}
        // Le clic sur une proposition passe par onMouseDown, avant le blur.
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("address.listLabel")}
          className={
            (inline ? "mt-1 " : "absolute left-0 top-[calc(100%+4px)] z-30 ") +
            // Cinq propositions sur deux lignes tiennent sans ascenseur.
            "max-h-72 w-full overflow-y-auto rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white p-1 shadow-lg"
          }
        >
          {suggestions.map((suggestion, i) => (
            <li key={suggestion.id} id={`${listId}-${i}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(suggestion);
                }}
                onMouseEnter={() => setIndex(i)}
                className={
                  "flex w-full flex-col items-start gap-0.5 rounded-[var(--pt-radius-sm)] px-2.5 py-1.5 text-left " +
                  (i === index ? "bg-[color:color-mix(in_srgb,var(--brand-primary)_10%,white)]" : "")
                }
              >
                <span className="w-full truncate text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
                  {suggestion.label}
                </span>
                <span className="w-full truncate text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                  {suggestionContext(suggestion)}
                  {suggestion.precision !== "adresse" ? ` · ${t(PRECISION_KEYS[suggestion.precision])}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Annonce vocale des propositions — sans elle, la liste n'existe que pour l'œil. */}
      <span role="status" aria-live="polite" className="sr-only">
        {showList ? tn("address.proposed", suggestions.length) : ""}
      </span>

      {(error || searching) && (
        <p className="mt-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {error ? t("address.unavailable") : t("address.searching")}
        </p>
      )}
    </div>
  );
}
