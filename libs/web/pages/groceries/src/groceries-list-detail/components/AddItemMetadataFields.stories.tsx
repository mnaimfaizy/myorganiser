import type { Meta, StoryObj } from '@storybook/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@myorganiser/web-ui';
import { AddItemMetadataFields } from './AddItemMetadataFields';
import { addItemSchema, type AddItemFormValues } from '../schemas';

const meta: Meta<typeof AddItemMetadataFields> = {
  component: AddItemMetadataFields,
  title: 'Components/AddItemMetadataFields',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AddItemMetadataFields>;

/**
 * Default story: First category (Produce) is selected.
 * Shows the 4-column category tile grid with one tile visibly selected.
 * Visual regression test: the selected tile (Produce) must have brand-colored border and background,
 * distinct from its unselected neighbours. This catches the affordance inversion bug where selected was fainter.
 */
export const Default: Story = {
  render: function Render() {
    const form = useForm<AddItemFormValues>({
      resolver: zodResolver(addItemSchema),
      defaultValues: {
        name: '',
        category: 'produce',
        amount: '',
        price: '',
        notes: '',
        imageUrl: '',
        links: [],
      },
    });

    return (
      <Form {...form}>
        <div className="w-full max-w-md p-4">
          <AddItemMetadataFields
            control={form.control}
            matchingCatalogItems={[]}
            activeSuggestion={0}
            showListbox={false}
            typedName=""
            onKeepTypedName={() => undefined}
            onNameChange={() => undefined}
            onNameKeyDown={() => undefined}
            onSelectCatalogItem={() => undefined}
            isLoading={false}
          />
        </div>
      </Form>
    );
  },
};

/**
 * DifferentCategorySelected story: Dairy category is selected.
 * Proves that different selections change which tile shows the brand styling.
 * In a static snapshot, the Dairy tile (second column) should have the selected appearance (brand color).
 */
export const DifferentCategorySelected: Story = {
  render: function Render() {
    const form = useForm<AddItemFormValues>({
      resolver: zodResolver(addItemSchema),
      defaultValues: {
        name: '',
        category: 'dairy',
        amount: '',
        price: '',
        notes: '',
        imageUrl: '',
        links: [],
      },
    });

    return (
      <Form {...form}>
        <div className="w-full max-w-md p-4">
          <AddItemMetadataFields
            control={form.control}
            matchingCatalogItems={[]}
            activeSuggestion={0}
            showListbox={false}
            typedName=""
            onKeepTypedName={() => undefined}
            onNameChange={() => undefined}
            onNameKeyDown={() => undefined}
            onSelectCatalogItem={() => undefined}
            isLoading={false}
          />
        </div>
      </Form>
    );
  },
};

/**
 * FirstCategorySelected story: Produce (first) category explicitly selected.
 * Catches off-by-one errors in grid layout — the first tile should receive the selected styling.
 * In a snapshot, Produce (🥬, top-left) must show border-brand and brand/10 background.
 */
export const FirstCategorySelected: Story = {
  render: function Render() {
    const form = useForm<AddItemFormValues>({
      resolver: zodResolver(addItemSchema),
      defaultValues: {
        name: '',
        category: 'produce',
        amount: '',
        price: '',
        notes: '',
        imageUrl: '',
        links: [],
      },
    });

    return (
      <Form {...form}>
        <div className="w-full max-w-md p-4">
          <AddItemMetadataFields
            control={form.control}
            matchingCatalogItems={[]}
            activeSuggestion={0}
            showListbox={false}
            typedName=""
            onKeepTypedName={() => undefined}
            onNameChange={() => undefined}
            onNameKeyDown={() => undefined}
            onSelectCatalogItem={() => undefined}
            isLoading={false}
          />
        </div>
      </Form>
    );
  },
};

/**
 * LastCategorySelected story: Other (last) category selected.
 * Catches off-by-one errors — the last tile in the grid should get the selected styling.
 * In a 4-column layout with 12 categories, Other is at position [2][3] (row 3, column 4).
 * In a snapshot, Other (📦, bottom-right) must show the selected appearance with brand styling.
 */
export const LastCategorySelected: Story = {
  render: function Render() {
    const form = useForm<AddItemFormValues>({
      resolver: zodResolver(addItemSchema),
      defaultValues: {
        name: '',
        category: 'other',
        amount: '',
        price: '',
        notes: '',
        imageUrl: '',
        links: [],
      },
    });

    return (
      <Form {...form}>
        <div className="w-full max-w-md p-4">
          <AddItemMetadataFields
            control={form.control}
            matchingCatalogItems={[]}
            activeSuggestion={0}
            showListbox={false}
            typedName=""
            onKeepTypedName={() => undefined}
            onNameChange={() => undefined}
            onNameKeyDown={() => undefined}
            onSelectCatalogItem={() => undefined}
            isLoading={false}
          />
        </div>
      </Form>
    );
  },
};

/**
 * Disabled story: Category grid with isLoading=true (buttons disabled).
 * Shows the disabled state styling — tiles should appear inactive/greyed and not respond to clicks.
 * In a snapshot, all tiles should show disabled appearance (opacity reduced or cursor not-allowed).
 */
export const Disabled: Story = {
  render: function Render() {
    const form = useForm<AddItemFormValues>({
      resolver: zodResolver(addItemSchema),
      defaultValues: {
        name: '',
        category: 'produce',
        amount: '',
        price: '',
        notes: '',
        imageUrl: '',
        links: [],
      },
    });

    return (
      <Form {...form}>
        <div className="w-full max-w-md p-4">
          <AddItemMetadataFields
            control={form.control}
            matchingCatalogItems={[]}
            activeSuggestion={0}
            showListbox={false}
            typedName=""
            onKeepTypedName={() => undefined}
            onNameChange={() => undefined}
            onNameKeyDown={() => undefined}
            onSelectCatalogItem={() => undefined}
            isLoading={true}
          />
        </div>
      </Form>
    );
  },
};
