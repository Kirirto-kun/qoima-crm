"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { asApiError } from "@/lib/api";
import { sales } from "@/lib/endpoints";
import type { SalesHotLead } from "@/lib/types";

export function HotLeadDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactNode;
  initial?: SalesHotLead;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const queryClient = useQueryClient();

  function openDialog() {
    setName(initial?.name ?? "");
    setContact(initial?.contact ?? "");
    setNote(initial?.note ?? "");
    setOpen(true);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        contact: contact.trim(),
        note: note.trim(),
      };
      return initial
        ? sales.hotLeads.update(initial.id, payload)
        : sales.hotLeads.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-hot-leads"] });
      toast.success(
        initial ? "Горячая заявка обновлена." : "Горячая заявка добавлена."
      );
      setOpen(false);
      if (!initial) {
        setName("");
        setContact("");
        setNote("");
      }
    },
    onError: (error) => toast.error(asApiError(error).message),
  });

  const isValid = name.trim().length > 0 && contact.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={openDialog}>{trigger}</div>
      <DialogContent className="max-w-[540px]">
        <DialogHeader
          eyebrow={
            initial
              ? "Горячие заявки · Редактирование"
              : "Горячие заявки · Новая заявка"
          }
          title={
            <span className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-tag-orange-bg text-tag-orange-fg">
                <Flame className="h-4 w-4" />
              </span>
              <span>{initial ? "Изменить заявку" : "Добавить заявку"}</span>
            </span>
          }
          description="Быстрый захват входящего интереса. Укажите имя или название и контакт — телефон или почту."
        />

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isValid) mutation.mutate();
          }}
        >
          <Field label="Имя или название">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Айдана или Alem Logistics"
              autoComplete="off"
              autoFocus
              required
            />
          </Field>

          <Field label="Контакт" hint="Телефон или почта">
            <Input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="+7 700 123 45 67 или client@mail.com"
              autoComplete="off"
              required
            />
          </Field>

          <Field label="Заметка" hint="Необязательно">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              placeholder="Что нужно клиенту, источник заявки или следующий шаг"
            />
          </Field>

          <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!isValid || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Сохраняем…
                </>
              ) : (
                <>
                  {!initial && <Plus className="h-3.5 w-3.5" />}
                  {initial ? "Сохранить" : "Добавить заявку"}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
