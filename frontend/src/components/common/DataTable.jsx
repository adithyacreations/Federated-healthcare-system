const DataTable = ({ columns = [], data = [], loading = false, emptyMessage = 'No records found.' }) => {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-primary-50 text-primary-600 uppercase text-xs tracking-wider">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-5 py-3 text-left font-semibold whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-4">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td className="px-5 py-10 text-center text-gray-500" colSpan={columns.length || 1}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={row.id || row._id || idx}
                  className="border-t border-gray-100 hover:bg-primary-50/40 transition"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-3 text-gray-700 whitespace-nowrap">
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataTable;
