"use client";

import {
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  DEFAULT_VENUE_TIMEZONE,
} from "@/lib/date";
import { captureImmutableDraft } from "@/lib/forms/immutable-draft";
import type { Venue } from "@/lib/venues/types";
import type {
  VenueDirectoryLoadResult,
  VenueMutationMessageResolver,
} from "./useVenueDirectoryController";

export type VenueCreateFormData = {
  name: string;
  type: Venue["type"];
  address: string;
  description: string;
  brandName: string;
  brandTagline: string;
  primaryDomain: string;
  defaultLocale: NonNullable<Venue["defaultLocale"]>;
  timezone: string;
  openingTime: string;
  closingTime: string;
};

export interface VenueCreateInput {
  name: string;
  type: Venue["type"];
  address?: string;
  description?: string;
  brandName?: string;
  brandTagline?: string;
  primaryDomain?: string;
  defaultLocale?: NonNullable<Venue["defaultLocale"]>;
  timezone?: string;
  openingTime?: string;
  closingTime?: string;
}

export interface VenueCreateControllerDependencies {
  createVenue: (
    input: VenueCreateInput,
  ) => Promise<{ data: Venue | null; error: string | null }>;
}

interface UseVenueCreateControllerOptions {
  dependencies: VenueCreateControllerDependencies;
  onCreated: () => Promise<VenueDirectoryLoadResult | void>;
  resolveMutationMessage: VenueMutationMessageResolver;
}

function createDefaultFormData(): VenueCreateFormData {
  return {
    name: "",
    type: "club",
    address: "",
    description: "",
    brandName: "",
    brandTagline: "",
    primaryDomain: "",
    defaultLocale: "en",
    timezone: DEFAULT_VENUE_TIMEZONE,
    openingTime: DEFAULT_OPENING_TIME,
    closingTime: DEFAULT_CLOSING_TIME,
  };
}

export default function useVenueCreateController({
  dependencies,
  onCreated,
  resolveMutationMessage,
}: UseVenueCreateControllerOptions) {
  const t = useTranslations("VenueAdmin");
  const [formData, setFormDataState] = useState<VenueCreateFormData>(
    createDefaultFormData,
  );
  const formDataRef = useRef(formData);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasNameValidationError, setHasNameValidationError] = useState(false);
  const hasNameValidationErrorRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const activeOperationOwnerRef = useRef<symbol | null>(null);

  const setFormData: Dispatch<SetStateAction<VenueCreateFormData>> = (value) => {
    const nextFormData =
      typeof value === "function" ? value(formDataRef.current) : value;
    formDataRef.current = nextFormData;
    setFormDataState(nextFormData);
    if (hasNameValidationErrorRef.current && nextFormData.name.trim()) {
      hasNameValidationErrorRef.current = false;
      setHasNameValidationError(false);
      setFormError("");
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeOperationOwnerRef.current) return;
    const owner = Symbol("venue-create");
    activeOperationOwnerRef.current = owner;
    const draft = captureImmutableDraft(formDataRef.current);
    setIsSubmitting(true);
    setFormError("");
    setFormSuccess("");
    setHasNameValidationError(false);
    hasNameValidationErrorRef.current = false;

    try {
      if (!draft.name.trim()) {
        setFormError(t("nameRequired"));
        setHasNameValidationError(true);
        hasNameValidationErrorRef.current = true;
        nameInputRef.current?.focus();
        return;
      }

      const { data, error } = await dependencies.createVenue({
        name: draft.name.trim(),
        type: draft.type,
        address: draft.address.trim() || undefined,
        description: draft.description.trim() || undefined,
        brandName: draft.brandName.trim() || undefined,
        brandTagline: draft.brandTagline.trim() || undefined,
        primaryDomain: draft.primaryDomain.trim() || undefined,
        defaultLocale: draft.defaultLocale,
        timezone: draft.timezone.trim(),
        openingTime: draft.openingTime,
        closingTime: draft.closingTime,
      });

      if (error) {
        console.error("Failed to create venue:", error);
        setFormError(resolveMutationMessage(error, "createFailed"));
      } else if (data) {
        setFormSuccess(t("created", { name: data.name }));
        setFormData(createDefaultFormData());
        try {
          const refreshResult = await onCreated();
          if (refreshResult?.status === "failed") {
            setFormError(t("loadFailed"));
          }
        } catch (refreshError: unknown) {
          console.error("Failed to refresh venues:", refreshError);
          setFormError(t("loadFailed"));
        }
      }
    } catch (error: unknown) {
      console.error("Failed to create venue:", error);
      setFormError(t("createFailed"));
    } finally {
      if (activeOperationOwnerRef.current === owner) {
        activeOperationOwnerRef.current = null;
        setIsSubmitting(false);
      }
    }
  };

  return {
    formData,
    hasDraft: Object.entries(createDefaultFormData()).some(([key, value]) => formData[key as keyof VenueCreateFormData] !== value),
    resetDraft: () => {
      if (activeOperationOwnerRef.current) return;
      setFormData(createDefaultFormData());
      setFormError("");
      setFormSuccess("");
      setHasNameValidationError(false);
      hasNameValidationErrorRef.current = false;
    },
    setFormData,
    formError,
    formSuccess,
    isSubmitting,
    hasNameValidationError,
    nameInputRef,
    handleCreate,
  };
}
