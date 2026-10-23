import { LogOutIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { signOut, useLedger } from "@/lib/ledger";

/** Lock this device. Asked about first, because the token is shown once and a
 *  device that forgets it may be the only place it was kept. */
export function SignOutButton() {
  const { unsaved } = useLedger();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Lock this device"
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOutIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lock this device?</AlertDialogTitle>
          <AlertDialogDescription>
            This browser will forget your token. Your coffees stay safe in the database, but you'll
            need the token to open them again — if it isn't saved anywhere else, they can't be
            recovered.
            {unsaved > 0 &&
              ` ${unsaved} change${unsaved === 1 ? " hasn't" : "s haven't"} finished saving and will be lost.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay signed in</AlertDialogCancel>
          <AlertDialogAction onClick={signOut}>Lock</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
