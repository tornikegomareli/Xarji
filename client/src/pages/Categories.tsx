import { useState } from "react";
import {
  Card,
  CardContent,
  Button,
  Modal,
  Input,
  EmptyState,
  Loading,
} from "../components/ui";
import { useCategories, useCategoryActions, useCategoryAnalytics } from "../hooks/useCategories";
import { formatCurrency, DEFAULT_CATEGORIES } from "../lib/utils";
import { Plus, Tag, Pencil, Trash2 } from "lucide-react";
import type { Category } from "../lib/instant";

const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#6b7280",
];

export function Categories() {
  const { categories, isLoading } = useCategories();
  const { addCategory, updateCategory, deleteCategory, initializeDefaultCategories } = useCategoryActions();
  const { withPercentages: categoryAnalytics } = useCategoryAnalytics();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: "", color: COLORS[0] });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setFormData({ name: category.name, color: category.color });
    } else {
      setEditingCategory(null);
      setFormData({ name: "", color: COLORS[0] });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    setFormData({ name: "", color: COLORS[0] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsSubmitting(true);
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: formData.name,
          color: formData.color,
        });
      } else {
        await addCategory({
          name: formData.name,
          color: formData.color,
          icon: "tag",
          isDefault: false,
        });
      }
      handleCloseModal();
    } catch (error) {
      console.error("Failed to save category:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm("Are you sure you want to delete this category?")) return;

    try {
      await deleteCategory(categoryId);
    } catch (error) {
      console.error("Failed to delete category:", error);
    }
  };

  const handleInitializeDefaults = async () => {
    try {
      await initializeDefaultCategories();
    } catch (error) {
      console.error("Failed to initialize categories:", error);
    }
  };

  // Merge categories with analytics data
  const categoriesWithStats = (categories.length > 0 ? categories : DEFAULT_CATEGORIES.map((c, i) => ({
    ...c,
    id: `default-${i}`,
    isDefault: true,
  }))).map((cat) => {
    const analytics = categoryAnalytics.find((a) => a.name === cat.name);
    return {
      ...cat,
      total: analytics?.total || 0,
      count: analytics?.count || 0,
      percentage: analytics?.percentage || 0,
    };
  });

  if (isLoading) {
    return <Loading className="py-12" />;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Categories</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage spending categories for your transactions
          </p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Category
        </Button>
      </div>

      {/* Categories Grid */}
      {categoriesWithStats.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categoriesWithStats.map((category) => (
            <Card key={category.id} className="overflow-hidden">
              <div
                className="h-2"
                style={{ backgroundColor: category.color }}
              />
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${category.color}20` }}
                    >
                      <Tag className="w-5 h-5" style={{ color: category.color }} />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900">{category.name}</h3>
                      <p className="text-sm text-slate-500">
                        {category.count} transaction{category.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  {!category.isDefault && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenModal(category as Category)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(category.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Total spent</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(category.total)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(category.percentage, 100)}%`,
                        backgroundColor: category.color,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 text-right">
                    {category.percentage.toFixed(1)}% of total
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Tag className="w-8 h-8" />}
            title="No categories yet"
            description="Create categories to organize your transactions"
            action={
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleInitializeDefaults}>
                  Use Defaults
                </Button>
                <Button onClick={() => handleOpenModal()}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Category
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={editingCategory ? "Edit Category" : "Add Category"}
        size="sm"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Category Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Food & Dining"
            required
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-lg transition-transform ${
                    formData.color === color ? "ring-2 ring-offset-2 ring-slate-900 scale-110" : ""
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editingCategory ? "Save Changes" : "Add Category"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
