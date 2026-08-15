export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1380px] animate-pulse space-y-6" role="status" aria-label="页面加载中">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div className="h-8 w-52 rounded-xl bg-mist-200/80" />
          <div className="h-4 w-72 max-w-full rounded-lg bg-mist-100" />
        </div>
        <div className="h-11 w-32 rounded-2xl bg-harbor-100" />
      </div>

      <section className="overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
        <div className="grid min-h-[520px] lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4 border-b border-app-line bg-app-subtle/55 p-6 lg:border-b-0 lg:border-r">
            <div className="h-5 w-32 rounded-lg bg-mist-200" />
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-app-line bg-white p-3">
                <div className="h-9 w-9 rounded-xl bg-mist-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 rounded bg-mist-200" />
                  <div className="h-2.5 w-16 rounded bg-mist-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid place-items-center p-8">
            <div className="w-full max-w-xl space-y-7">
              <div className="h-6 w-44 rounded-lg bg-mist-200" />
              <div className="mx-auto h-52 w-80 max-w-full rounded-[50%] bg-harbor-100/75" />
              <div className="h-3 w-full rounded-full bg-mist-200" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-10 rounded-full bg-mist-100" />)}
              </div>
            </div>
          </div>
        </div>
      </section>
      <span className="sr-only">页面加载中</span>
    </div>
  );
}
