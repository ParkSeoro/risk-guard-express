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
    <DropdownMenu>
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
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> 회차 수정
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem onClick={onClone}>
            <Copy className="h-3.5 w-3.5 mr-2" /> 개정 회차 생성
          </DropdownMenuItem>
        )}
        {(canEdit || canDelete) && <DropdownMenuSeparator />}
        {canDelete && !run.is_deleted && (
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" /> 회차 삭제
          </DropdownMenuItem>
        )}
        {canRestore && run.is_deleted && (
          <DropdownMenuItem onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5 mr-2" /> 복구
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RunCardActions;
