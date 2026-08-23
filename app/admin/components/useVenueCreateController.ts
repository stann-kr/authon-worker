"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  DEFAULT_VENUE_TIMEZONE,
} from "@/lib/date";
import { captureImmutableDraft } from "@/lib/forms/immutable-draft";
import type { Venue } from "@/lib/venues/types";
import type { VenueMutationMessageResolver } from "./useVenueDirectoryController";

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
  onCreated: () => Promise<void>;
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
  const [formData, setFormData] = useState<VenueCreateFormData>(
    createDefaultFormData,
  );
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const draft = captureImmutableDraft(formData);
    setIsSubmitting(true);
    setFormError("");
    setFormSuccess("");

    if (!draft.name.trim()) {
      setFormError(t("nameRequired"));
      setIsSubmitting(false);
      return;
    }

    try {
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
        await onCreated();
      }
    } catch (error: unknown) {
      console.error("Failed to create venue:", error);
      setFormError(t("createFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    setFormData,
    formError,
    formSuccess,
    isSubmitting,
    handleCreate,
  };
}
