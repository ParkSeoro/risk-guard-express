import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RunCardActionsProps {
  run: any;
  canEdit: boolean;
  canDelete: boolean;
  canRestore: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClone: () => void;
  onRestore?: () => void;
}

const RunCardActions = ({
  run,
  canEdit,
  canDelete,
  canRestore,
  onEdit,
  onDelete,
  onClone,
  onRestore,
}: RunCardActionsProps) => {
  if (!canEdit && !canDelete && !canRestore) return null;

  return (
    // modal={false}: opening Dialog/AlertDialog from a modal Dropdown leaves
    // body { pointer-events: none } stuck after close (Radix dismissable-layer).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {canEdit && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              // Defer so the menu finishes closing before the dialog mounts.
              window.setTimeout(() => onEdit(), 0);
            }}
          >
            <Pencil className="h-3.5 w-3.5 mr-2" /> 회차 수정
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              window.setTimeout(() => onClone(), 0);
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-2" /> 개정 회차 생성
          </DropdownMenuItem>
        )}
        {(canEdit || canDelete) && <DropdownMenuSeparator />}
        {canDelete && !run.is_deleted && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(e) => {
              e.preventDefault();
              window.setTimeout(() => onDelete(), 0);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> 회차 삭제
          </DropdownMenuItem>
        )}
        {canRestore && run.is_deleted && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              window.setTimeout(() => onRestore?.(), 0);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-2" /> 복구
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RunCardActions;
