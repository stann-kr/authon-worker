import Icon from "@/components/Icon";
import ButtonLink from "@/components/ButtonLink";
import { getRequestTenantContext } from "@/lib/tenant/server";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const [{ brand }, t] = await Promise.all([
    getRequestTenantContext(),
    getTranslations("Common"),
  ]);
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 text-center">
      <div className="app-panel w-full max-w-md p-8 sm:p-10">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-panel border border-border-default bg-surface-raised text-text-muted">
          <Icon name="warning" size={22} />
        </div>
        <p className="font-mono text-sm text-text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-text-heading">
          {t("notFoundTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {t("notFoundDescription", { brand: brand.name })}
        </p>
        <div className="mx-auto mt-8 w-full max-w-xs">
          <ButtonLink
            href="/"
            fullWidth
            size="lg"
          >
            {t("goHome")}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
