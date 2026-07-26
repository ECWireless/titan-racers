import { ProfileAccess } from "@/components/profile-access";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const requestedReturnTo = (await searchParams).returnTo;
  return (
    <ProfileAccess
      mode="onboarding"
      returnTo={
        Array.isArray(requestedReturnTo)
          ? requestedReturnTo[0]
          : requestedReturnTo
      }
    />
  );
}
