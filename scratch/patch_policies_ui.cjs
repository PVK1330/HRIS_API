const fs = require('fs');
const p = 'D:/HRIS/src/pages/admin/compliance/Policies.jsx';
let s = fs.readFileSync(p, 'utf8');

// Remove accidental motion.div tags
s = s.replace(/<\/?motion\.div>/g, '');

const blockStart = s.indexOf(
  '            <motion.div className="overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm">',
);
const blockStart2 = s.indexOf(
  '            <div className="overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm">',
);
const start = blockStart >= 0 ? blockStart : blockStart2;
const dashEnd = s.indexOf("        {activeView === 'categories'", start);

const tableBlock = `            <div className="overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#0F766E] bg-[#0F766E] px-5 py-3">
                <h2 className="text-sm font-semibold text-white">Policy Listing</h2>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <div className="relative min-w-[250px] flex-1 max-w-md">
                  <HiMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search policy title or category..."
                    className="h-10 w-full rounded-none border border-slate-200 bg-slate-50/70 px-3 pl-9 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#0F766E] focus:bg-white focus:ring-1 focus:ring-[#0F766E] font-medium"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-10 rounded-none border border-slate-200 bg-slate-50/70 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]"
                  >
                    <option value="">All categories</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <p className="text-xs font-medium text-slate-500">{filtered.length} records shown</p>
                  {(q || categoryFilter || statusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => { setQ(''); setCategoryFilter(''); setStatusFilter('all') }}
                      className="inline-flex items-center rounded-none border border-dashed border-slate-200 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition hover:border-slate-300 hover:text-slate-900 hover:bg-slate-50/50"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
              </div>

              {filtered.length > 0 ? (
                <Table columns={columns} data={filtered} pageSize={10} loading={loading} square />
              ) : !loading ? (
                <EmptyState
                  title="No policies found"
                  description="Create your first policy or adjust filters to see results."
                  image="/global_no_data.png"
                  actionLabel={isHR ? 'Add Policy' : null}
                  icon={HiPlus}
                  onAction={() => openPolicyModal()}
                />
              ) : null}
            </div>
          </div>
        )}

`;

if (start < 0 || dashEnd < 0) {
  console.error('markers not found', start, dashEnd);
  process.exit(1);
}

s = s.slice(0, start) + tableBlock + s.slice(dashEnd);

// Remove full-page editor
const editorStart = s.indexOf("        {activeView === 'editor' && (");
const editorEnd = s.indexOf("        {activeView === 'tracking' && (", editorStart);
if (editorStart > 0 && editorEnd > editorStart) {
  s = s.slice(0, editorStart) + s.slice(editorEnd);
}

// PolicyFormModal component
if (!s.includes('<PolicyFormModal')) {
  s = s.replace(
    '<PolicyPublishSettingsModal',
    `<PolicyFormModal
        isOpen={policyModalOpen}
        onClose={closePolicyModal}
        editMode={!!formData.id}
        formData={formData}
        setFormData={setFormData}
        categories={categories}
        updateSection={updateSection}
        onSaveDraft={() => handleSave('Draft')}
        onPublish={handlePublishFromModal}
        onManageAttachments={() => setAttachmentModalOpen(true)}
        saving={savingPolicy || savingPublish}
      />

      <PolicyPublishSettingsModal`,
  );
}

// Category modal header
s = s.replace(
  `      <Modal 
        isOpen={modalOpen} 
        onClose={() => {
          setModalOpen(false)
          setEditingCategory(null)
          setNewCategoryName('')
        }} 
        title={editingCategory ? "Update Category" : "Create Policy Category"} 
        size="md"
      >
        <div className="space-y-4">
          <Input 
            label="Category Name" 
            placeholder="e.g., Remote Operations" 
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />`,
  `      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingCategory(null)
          setNewCategoryName('')
        }}
        size="md"
        showClose
        header={
          <div className="flex flex-col gap-1 pr-8">
            <h2 className="text-lg font-bold text-slate-900">
              {editingCategory ? 'Edit Category' : 'Add New Category'}
            </h2>
            <p className="text-xs font-medium text-slate-500">
              Organize policies into categories for easier browsing and reporting.
            </p>
          </div>
        }
      >
        <div className="space-y-4 pt-2">
          <Input
            label="Category Name"
            placeholder="e.g. Remote Operations"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            inputClassName="h-10 rounded-lg border-slate-300 focus:border-[#0F766E] focus:ring-[#0F766E]/20"
            labelClassName="mb-1 block text-sm font-medium text-slate-800"
          />`,
);

s = s.replace(
  `          <motion.div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button label="Cancel" variant="ghost" onClick={() => setModalOpen(false)} />
            <Button label={editingCategory ? "Save Changes" : "Add Category"} variant="primary" onClick={handleAddCategory} />
          </motion.div>`,
  `          <div className="flex items-center justify-end gap-3 pt-6 mt-2 border-t border-slate-100">
            <button type="button" onClick={() => setModalOpen(false)} className="h-10 rounded-md border border-slate-300 bg-white px-6 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={handleAddCategory} className="h-10 rounded-md bg-[#0F766E] px-6 text-sm font-semibold text-white hover:bg-[#0d5c56]">{editingCategory ? 'Save Changes' : 'Add Category'}</button>
          </motion.div>`,
);

s = s.replace(/<\/?motion\.div>/g, '');

fs.writeFileSync(p, s);
console.log('done');
