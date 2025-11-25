import { CheckCircle2, AlertTriangle } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface WalletStatusProps {
  signedAccountId: string | undefined;
  loading?: boolean;
  showWarningIfNotConnected?: boolean;
}

export const WalletStatus = ({
  signedAccountId,
  loading,
  showWarningIfNotConnected = true,
}: WalletStatusProps) => {
  if (loading) {
    return (
      <div className="mb-6 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!signedAccountId && showWarningIfNotConnected) {
    return (
      <Alert
        variant="destructive"
        className="mb-6 border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950 dark:text-red-100"
      >
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-red-900 dark:text-red-100">
          Wallet not connected
        </AlertTitle>
        <AlertDescription className="text-red-900/80 dark:text-red-100/80">
          Please connect your NEAR account to continue.
        </AlertDescription>
      </Alert>
    );
  }

  if (signedAccountId) {
    return (
      <Card className="mb-6 border-green-200 bg-green-50 text-green-900 shadow-sm dark:border-green-900/50 dark:bg-green-950 dark:text-green-50">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-300" />
          <div>
            <CardTitle className="text-lg text-green-900 dark:text-green-50">
              NEAR Wallet Connected
            </CardTitle>
            <CardDescription className="text-green-900/80 dark:text-green-100/80">
              {signedAccountId}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return null;
};
