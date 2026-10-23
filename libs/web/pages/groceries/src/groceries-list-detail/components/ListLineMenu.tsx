'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@myorganiser/web-ui';
import {
  AlertTriangle,
  MoreVertical,
  Pencil,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface ListLineMenuProps {
  name: string;
  lineId: string;
  catalogItemId: string | undefined;
  /** Phone rows keep Edit amount in the menu; desktop rows show it as a button. */
  showEditAmount: boolean;
  isBusy: boolean;
  onEditLine: (lineId: string) => void;
  onEditCatalogItem: (catalogItemId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onRequestDeleteFromCatalog: (catalogItemId: string) => void;
}

const CONFIRM_RESET_MS = 3000;

/**
 * The "More for {name}" menu of one List Line. Removing a line from the list
 * takes two selections: the first arms "Confirm remove line", which disarms
 * itself after three seconds.
 */
export function ListLineMenu({
  name,
  lineId,
  catalogItemId,
  showEditAmount,
  isBusy,
  onEditLine,
  onEditCatalogItem,
  onRemoveLine,
  onRequestDeleteFromCatalog,
}: ListLineMenuProps) {
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  useEffect(() => {
    if (!isConfirmingRemove) return;
    const timer = setTimeout(
      () => setIsConfirmingRemove(false),
      CONFIRM_RESET_MS,
    );
    return () => clearTimeout(timer);
  }, [isConfirmingRemove]);

  const handleEditAmount = useCallback(() => {
    onEditLine(lineId);
  }, [lineId, onEditLine]);

  const handleEditCatalog = useCallback(() => {
    if (catalogItemId) onEditCatalogItem(catalogItemId);
  }, [catalogItemId, onEditCatalogItem]);

  const handleRemoveSelect = useCallback(
    (event: Event) => {
      if (isConfirmingRemove) {
        onRemoveLine(lineId);
        setIsConfirmingRemove(false);
        return;
      }
      event.preventDefault();
      setIsConfirmingRemove(true);
    },
    [isConfirmingRemove, lineId, onRemoveLine],
  );

  const handleDeleteFromCatalog = useCallback(() => {
    if (catalogItemId) onRequestDeleteFromCatalog(catalogItemId);
  }, [catalogItemId, onRequestDeleteFromCatalog]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          label={`More for ${name}`}
          icon={<MoreVertical />}
          disabled={isBusy}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {showEditAmount ? (
          <DropdownMenuItem onSelect={handleEditAmount}>
            <Pencil />
            Edit amount
          </DropdownMenuItem>
        ) : null}
        {catalogItemId ? (
          <DropdownMenuItem onSelect={handleEditCatalog}>
            <SquarePen />
            Edit Catalog Item
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={handleRemoveSelect}>
          <Trash2 />
          {isConfirmingRemove ? 'Confirm remove line' : 'Remove from list'}
        </DropdownMenuItem>
        {catalogItemId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={handleDeleteFromCatalog}
            >
              <AlertTriangle />
              Delete from Catalog
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
