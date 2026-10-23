<template>

  <div class="users-page h-full flex flex-col">

    <a-card :bordered="false" :body-style="{ padding: 0, display: 'flex', flex: '1', minHeight: 0 }" class="users-card flex-1 min-h-0 min-w-0 flex flex-col">
      <!-- 组织架构栏（可管理：hover 新增/编辑/删除；可折叠缩成左侧窄条，用户管理区最大化） -->
      <div
        class="org-panel"
        :class="orgCollapsed
          ? 'org-panel--collapsed w-8 shrink-0 border-r border-[#f8f7f7] flex flex-col items-center py-3 cursor-pointer hover:bg-[#f8f7f7]'
          : 'w-58 shrink-0 border-r border-[#f8f7f7] py-3 overflow-y-auto'"
        :role="orgCollapsed ? 'button' : undefined"
        :tabindex="orgCollapsed ? 0 : -1"
        @click="orgCollapsed && toggleOrg()"
        @keydown.enter.prevent="orgCollapsed && toggleOrg()"
      >
        <!-- 收起态：窄条开关 -->
        <template v-if="orgCollapsed">
          <a-tooltip title="展开组织架构">
            <MenuUnfoldOutlined class="text-[#424245]" />
          </a-tooltip>
          <span class="org-panel-label text-sm text-[#424245] mt-3 [writing-mode:vertical-rl] tracking-widest">组织架构</span>
        </template>
        <!-- 展开态：标题 + 树 -->
        <template v-else>
          <div class="flex items-center justify-between mb-2 px-1">
            <div class="text-sm font-semibold text-[#201d1d]">组织架构</div>
            <div class="flex items-center">
              <a-tooltip title="新增顶级部门">
                <a-button type="text" size="small" @click.stop="openDeptCreate(null)"><PlusOutlined /></a-button>
              </a-tooltip>
              <a-tooltip title="收起组织架构">
                <a-button type="text" size="small" @click.stop="toggleOrg"><MenuFoldOutlined /></a-button>
              </a-tooltip>
            </div>
          </div>
          <a-input
            v-model:value="orgKeyword"
            class="mb-2"
            placeholder="搜索名称或编码"
            allow-clear
            aria-label="搜索组织架构"
            @keydown.esc="onOrgSearchEsc"
          />
          <div v-if="orgSelectedHidden" class="mb-2 px-1">
            <a-tag class="org-selected-tip" closable @close="onSelectedTipClose">列表仍按「{{ orgSelectedName }}」筛选</a-tag>
          </div>
          <a-tree
            v-if="orgTreeVisible.length"
            :tree-data="orgTreeVisible"
            v-model:selectedKeys="selectedDeptKey"
            v-model:expandedKeys="orgExpandedKeys"
            block-node
            @select="onTreeSelect"
          >
            <template #title="node">
              <div class="flex items-center justify-between group min-w-0">
                <span class="flex items-center gap-1.5 min-w-0">
                  <component :is="node.id === 'all' ? ApartmentOutlined : AppstoreOutlined" class="text-[#646262] text-sm shrink-0" />
                  <span class="truncate"><template v-for="(seg, si) in splitHighlight(node.name, orgKeyword)" :key="si"><mark v-if="seg.hit" class="org-hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>

                  <span class="text-[#424245] text-sm shrink-0">({{ node.count }})</span>
                </span>
                <span v-if="node.id !== 'all'" class="hidden group-hover:flex items-center shrink-0">
                  <a-tooltip title="添加子部门"><a-button type="text" size="small" class="w-6! h-6! px-0!" @click.stop="openDeptCreate(node)"><PlusOutlined /></a-button></a-tooltip>
                  <a-tooltip title="编辑部门"><a-button type="text" size="small" class="w-6! h-6! px-0!" @click.stop="openDeptEdit(node)"><EditOutlined /></a-button></a-tooltip>
                  <a-popconfirm title="确定删除该部门？" ok-text="确定" cancel-text="取消" @confirm="handleDeptDelete(node.id)">
                    <a-button type="text" size="small" danger class="w-6! h-6! px-0!" @click.stop><DeleteOutlined /></a-button>
                  </a-popconfirm>
                </span>
              </div>
            </template>
          </a-tree>
          <div v-else class="org-search-empty" role="status">没有匹配的部门</div>
        </template>
      </div>

      <div class="flex-1 min-w-0 min-h-0 flex flex-col">

      <div class="flex justify-end items-center mb-3 gap-2 shrink-0">
        <a-tooltip title="新增用户">
          <a-button type="primary" class="w-9! h-9! px-0! flex items-center justify-center" @click="showCreateModal">
            <PlusOutlined class="text-base!" />
          </a-button>
        </a-tooltip>
        <ColumnSettings icon-only v-model:columns="columns" :all-columns="allColumns" storage-key="starter-cols-users-main" :widths="widthsEditable" />
      </div>

      <ListFilters :tags="filterTags" :total="total" :dirty="dirty" :loading="loading" :failed="failed" @apply="apply()" @reset="onFiltersReset" @remove="removeFilter" @retry="fetchUsers">
        <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索账号或姓名" allow-clear style="width:200px" @press-enter="onSearchEnter" /></label>
        <label class="filter-field">状态<a-select v-model:value="draft.statuses" mode="multiple" :options="userStatusOptions" allow-clear placeholder="全部状态" style="min-width:150px;max-width:240px" /></label>
        <template #more><label class="filter-field">创建时间<a-range-picker v-model:value="draft.created" value-format="YYYY-MM-DD" :presets="filterDatePresets()" style="width:240px" /></label></template>
        <template #views><FilterViews module-key="system-users" :applied="appliedRecord" :sort="sort" :known-fields="['keyword', 'statuses', 'created', 'deptId']" :date-fields="['created']" :disabled="loading" @apply-view="onApplyView" /></template>
      </ListFilters>

      <!-- 已开通用户表格 -->
      <!-- 表格滚动区（内部上下滚动；表头吸顶）。v-if 在容器上：非激活页签的容器不渲染，
           避免两个 flex-1 容器对半平分剩余高度（否则激活表格只吃一半空间，下方留白） -->
      <div  class="flex-1 min-h-0 overflow-y-auto">

      <a-table
        :ref="setTableRef"
        :key="orgCollapsed ? 'org-collapsed' : 'org-open'"
        :columns="columns"
        :data-source="users"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="middle"
        :sticky="true"
        :scroll="{ x: 'max-content' }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-badge :status="record.status === 1 ? 'success' : 'error'" :text="record.status === 1 ? '启用' : '禁用'" />
          </template>
          <template v-if="column.key === 'createdAt'">
            {{ formatDate(record.createdAt) }}
          </template>
          <template v-if="column.key === 'role'">
            <a-tag>{{ record.role?.name || '未分配' }}</a-tag>
          </template>

          <template v-if="column.key === 'action'">
            <a-space class="user-actions" :size="2" wrap>
              <a-tooltip v-if="!isSuperAdminUser(record)" title="数据范围">
                <a-button type="text" size="small" class="w-6! h-6! px-0!" @click="openDataScope(record)"><SafetyOutlined /></a-button>
              </a-tooltip>
              <a-tooltip title="编辑">
                <a-button type="text" size="small" aria-label="编辑用户" class="w-6! h-6! px-0!" @click="showEditModal(record)"><EditOutlined /></a-button>
              </a-tooltip>
              <a-tooltip title="删除">
                <a-popconfirm title="确定要删除该用户吗？" ok-text="确定" cancel-text="取消" @confirm="handleDelete(record.id)">
                  <a-button type="text" size="small" danger aria-label="删除用户" class="w-6! h-6! px-0!"><DeleteOutlined /></a-button>
                </a-popconfirm>
              </a-tooltip>
              <a-tooltip :title="record.status === 1 ? '禁用' : '启用'">
                <a-popconfirm
                  :title="record.status === 1 ? '确定要禁用该用户吗？' : '确定要启用该用户吗？'"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="handleToggleStatus(record)"
                >
                  <a-button type="text" size="small" class="w-6! h-6! px-0!" :danger="record.status === 1" :aria-label="record.status === 1 ? '禁用用户' : '启用用户'">
                    <component
                      :is="record.status === 1 ? StopOutlined : CheckCircleOutlined"
                      :style="record.status === 1 ? undefined : { color: '#30d158' }"
                    />
                  </a-button>
                </a-popconfirm>
              </a-tooltip>
            </a-space>
          </template>
        </template>
      </a-table>
      </div>

      <StickyScrollBar :source="stickySource" />

    <a-modal
      :open="createVisible"
      :body-style="{ maxHeight: '65dvh', overflowY: 'auto' }"
      :mask-closable="!createLoading" :keyboard="!createLoading" :closable="!createLoading"
      :cancel-button-props="{ disabled: createLoading }" @cancel="closeCreate"
      :confirm-loading="createLoading"
      ok-text="确认新增"
      cancel-text="取消"
      @ok="handleCreate"
      width="560px"
    >
      <template #title>
        <div class="flex items-center gap-2">
          <UserAddOutlined class="text-primary" />
          <span>新增用户</span>
        </div>
      </template>
      <div ref="createFeedbackRoot"><FormFeedback :items="createFeedbackItems" :request-id="createRequestId" @focus="createFeedback.focus" /><a-form :model="createForm" layout="vertical">
        <div class="form-section-title">基础信息</div>
        <a-row :gutter="16">
          <a-col :span="24">
            <a-form-item label="登录账号" required data-form-field="loginid" :validate-status="createErrors.loginid ? 'error' : undefined">
              <a-input v-model:value="createForm.loginid" :disabled="createLoading" aria-label="登录账号" v-bind="createFeedback.attrs('loginid')" placeholder="输入登录账号" :maxlength="50">
                <template #prefix><IdcardOutlined class="text-[#646262]" /></template>
              </a-input>
            <p v-if="createErrors.loginid" :id="createFeedback.errorId('loginid')" class="field-error">{{ createErrors.loginid }}</p></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="姓名" required data-form-field="displayName" :validate-status="createErrors.displayName ? 'error' : undefined">
              <a-input v-model:value="createForm.displayName" :disabled="createLoading" aria-label="姓名" v-bind="createFeedback.attrs('displayName')" placeholder="显示姓名" :maxlength="50">
                <template #prefix><UserOutlined class="text-[#646262]" /></template>
              </a-input>
            <p v-if="createErrors.displayName" :id="createFeedback.errorId('displayName')" class="field-error">{{ createErrors.displayName }}</p></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="初始密码" required data-form-field="password" :validate-status="createErrors.password ? 'error' : undefined">
              <a-input-password v-model:value="createForm.password" :disabled="createLoading" aria-label="初始密码" v-bind="createFeedback.attrs('password')" placeholder="设置登录密码，至少 3 位" :maxlength="72">
                <template #prefix><LockOutlined class="text-[#646262]" /></template>
              </a-input-password>
            <p v-if="createErrors.password" :id="createFeedback.errorId('password')" class="field-error">{{ createErrors.password }}</p></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="邮箱" data-form-field="email" :validate-status="createErrors.email ? 'error' : undefined">
              <a-input v-model:value="createForm.email" :disabled="createLoading" aria-label="邮箱" v-bind="createFeedback.attrs('email')" placeholder="选填">
                <template #prefix><MailOutlined class="text-[#646262]" /></template>
              </a-input>
            <p v-if="createErrors.email" :id="createFeedback.errorId('email')" class="field-error">{{ createErrors.email }}</p></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="手机号" data-form-field="phone" :validate-status="createErrors.phone ? 'error' : undefined">
              <a-input v-model:value="createForm.phone" :disabled="createLoading" aria-label="手机号" v-bind="createFeedback.attrs('phone')" placeholder="选填">
                <template #prefix><PhoneOutlined class="text-[#646262]" /></template>
              </a-input>
            <p v-if="createErrors.phone" :id="createFeedback.errorId('phone')" class="field-error">{{ createErrors.phone }}</p></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="部门" data-form-field="deptId" :validate-status="createErrors.deptId ? 'error' : undefined">
              <a-select
                v-model:value="createForm.deptId" :disabled="createLoading" aria-label="部门" v-bind="createFeedback.attrs('deptId')"
                placeholder="选择部门"
                allow-clear
                style="width: 100%"
              >
                <a-select-option v-for="d in allDepts" :key="d.id" :value="d.id">{{ d.name }}</a-select-option>
              </a-select>
            <p v-if="createErrors.deptId" :id="createFeedback.errorId('deptId')" class="field-error">{{ createErrors.deptId }}</p></a-form-item>
          </a-col>
          <a-col :span="24">

            <a-form-item label="直属上级" data-form-field="leaderId" :validate-status="createErrors.leaderId ? 'error' : undefined">
              <a-select
                v-model:value="createForm.leaderId" :disabled="createLoading" aria-label="直属上级" v-bind="createFeedback.attrs('leaderId')"
                placeholder="选择直属上级"
                allow-clear
                style="width: 100%"
                :options="leaderOptions.map((o) => ({ label: `${o.displayName || o.username}${o.deptName ? `（${o.deptName}）` : ''}`, value: o.id }))"
              />
            <p v-if="createErrors.leaderId" :id="createFeedback.errorId('leaderId')" class="field-error">{{ createErrors.leaderId }}</p></a-form-item>
          </a-col>
        </a-row>
        <div class="form-section-title">角色权限</div>
        <a-row :gutter="16">
          <a-col :span="24">
            <a-form-item label="角色" data-form-field="roleId" :validate-status="createErrors.roleId ? 'error' : undefined">
              <a-select v-model:value="createForm.roleId" :disabled="createLoading" aria-label="角色" v-bind="createFeedback.attrs('roleId')" placeholder="选择角色" allow-clear style="width: 100%">
                <a-select-option v-for="r in allRoles" :key="r.id" :value="r.id">{{ r.name }}</a-select-option>
              </a-select>
            <p v-if="createErrors.roleId" :id="createFeedback.errorId('roleId')" class="field-error">{{ createErrors.roleId }}</p></a-form-item>
          </a-col>
          <a-col :span="24">

            <a-form-item label="附加角色" data-form-field="roleIds" :validate-status="createErrors.roleIds ? 'error' : undefined">
              <a-select v-model:value="createForm.roleIds" :disabled="createLoading" aria-label="附加角色" v-bind="createFeedback.attrs('roleIds')" mode="multiple" placeholder="可选多个" style="width: 100%">
                <a-select-option v-for="r in allRoles" :key="r.id" :value="r.id" :disabled="r.id === createForm.roleId">{{ r.name }}</a-select-option>
              </a-select>
            <p v-if="createErrors.roleIds" :id="createFeedback.errorId('roleIds')" class="field-error">{{ createErrors.roleIds }}</p></a-form-item>
          </a-col>
        </a-row>
      </a-form></div>
    </a-modal>

    <a-modal
      :open="deptModalVisible"
      :title="deptEditId ? '编辑部门' : '新增部门'"
      :confirm-loading="deptModalLoading"
      :mask-closable="!deptModalLoading" :keyboard="!deptModalLoading" :closable="!deptModalLoading"
      :cancel-button-props="{ disabled: deptModalLoading }" @cancel="closeDeptModal"
      ok-text="保存" cancel-text="取消"
      @ok="handleDeptSubmit"
      width="480px"
    >
      <div ref="deptFeedbackRoot">
      <FormFeedback :items="deptFeedbackItems" :request-id="deptRequestId" @focus="deptFeedback.focus" />
      <a-form layout="vertical">
        <a-form-item label="上级部门">
          <a-select v-model:value="deptForm.parentId" :disabled="deptModalLoading" placeholder="不选则为顶级部门" allow-clear style="width: 100%">
            <a-select-option v-for="d in deptOptionsFlat" :key="d.id" :value="d.id" :disabled="d.id === deptEditId">{{ d.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="部门名称" required data-form-field="name" :validate-status="deptErrors.name ? 'error' : undefined">
          <a-input v-model:value="deptForm.name" :disabled="deptModalLoading" aria-label="部门名称" v-bind="deptFeedback.attrs('name')" placeholder="如：计划部" :maxlength="50" />
          <p v-if="deptErrors.name" :id="deptFeedback.errorId('name')" class="field-error">{{ deptErrors.name }}</p>
        </a-form-item>
        <a-form-item label="部门编码" required data-form-field="code" :validate-status="deptErrors.code ? 'error' : undefined">
          <a-input v-model:value="deptForm.code" :disabled="!!deptEditId || deptModalLoading" aria-label="部门编码" v-bind="deptFeedback.attrs('code')" placeholder="如：sales" :maxlength="50" />
          <p v-if="deptErrors.code" :id="deptFeedback.errorId('code')" class="field-error">{{ deptErrors.code }}</p>
          <div class="text-gray-400 text-sm mt-1">编码是部门的稳定标识，创建后不可修改</div>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="排序">
              <a-input-number v-model:value="deptForm.sort" :min="0" :disabled="deptModalLoading" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="状态">
              <a-select v-model:value="deptForm.status" :disabled="deptModalLoading" :options="[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
      </div>
    </a-modal>

    <a-modal
      :open="editVisible"
      :confirm-loading="editLoading"
      :mask-closable="!editLoading" :keyboard="!editLoading" :closable="!editLoading"
      :cancel-button-props="{ disabled: editLoading }" @cancel="closeEdit"
      ok-text="保存" cancel-text="取消" @ok="handleEdit" width="560px"
    >
      <template #title>
        <div class="flex items-center gap-2">
          <EditOutlined class="text-primary" />
          <span>编辑用户</span>
        </div>
      </template>
      <div ref="editFeedbackRoot">
      <FormFeedback :items="editFeedbackItems" :request-id="editRequestId" @focus="editFeedback.focus" />
      <a-form :model="editForm" layout="vertical">
        <div class="form-section-title">基础信息</div>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="登录账号">
              <a-input :value="editForm.username" disabled>
                <template #prefix><IdcardOutlined class="text-[#646262]" /></template>
              </a-input>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="姓名" data-form-field="displayName" :validate-status="editErrors.displayName ? 'error' : undefined">
              <a-input v-model:value="editForm.displayName" :disabled="editLoading" aria-label="姓名" v-bind="editFeedback.attrs('displayName')" placeholder="显示姓名" :maxlength="50" />
              <p v-if="editErrors.displayName" :id="editFeedback.errorId('displayName')" class="field-error">{{ editErrors.displayName }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="邮箱" data-form-field="email" :validate-status="editErrors.email ? 'error' : undefined">
              <a-input v-model:value="editForm.email" :disabled="editLoading" aria-label="邮箱" v-bind="editFeedback.attrs('email')" placeholder="选填">
                <template #prefix><MailOutlined class="text-[#646262]" /></template>
              </a-input>
              <p v-if="editErrors.email" :id="editFeedback.errorId('email')" class="field-error">{{ editErrors.email }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="手机号" data-form-field="phone" :validate-status="editErrors.phone ? 'error' : undefined">
              <a-input v-model:value="editForm.phone" :disabled="editLoading" aria-label="手机号" v-bind="editFeedback.attrs('phone')" placeholder="选填">
                <template #prefix><PhoneOutlined class="text-[#646262]" /></template>
              </a-input>
              <p v-if="editErrors.phone" :id="editFeedback.errorId('phone')" class="field-error">{{ editErrors.phone }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="部门" data-form-field="deptId" :validate-status="editErrors.deptId ? 'error' : undefined">
              <a-select
                v-model:value="editForm.deptId"
                :disabled="editLoading"
                aria-label="部门"
                v-bind="editFeedback.attrs('deptId')"
                placeholder="选择部门"
                allow-clear
                style="width: 100%"
              >
                <a-select-option v-for="d in allDepts" :key="d.id" :value="d.id">{{ d.name }}</a-select-option>
              </a-select>
              <p v-if="editErrors.deptId" :id="editFeedback.errorId('deptId')" class="field-error">{{ editErrors.deptId }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="24">

            <a-form-item label="直属上级" data-form-field="leaderId" :validate-status="editErrors.leaderId ? 'error' : undefined">
              <a-select
                v-model:value="editForm.leaderId"
                :disabled="editLoading"
                aria-label="直属上级"
                v-bind="editFeedback.attrs('leaderId')"
                placeholder="选择直属上级（可跨部门）"
                allow-clear
                style="width: 100%"
                :options="leaderOptions.filter((o) => o.id !== editForm.id).map((o) => ({ label: `${o.displayName || o.username}${o.deptName ? `（${o.deptName}）` : ''}`, value: o.id }))"
              />
              <p v-if="editErrors.leaderId" :id="editFeedback.errorId('leaderId')" class="field-error">{{ editErrors.leaderId }}</p>
              <div class="text-sm text-[#646262] mt-1">用于组织汇报关系，不代表业务审批权限。</div>
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="重设密码" data-form-field="password" :validate-status="editErrors.password ? 'error' : undefined">
              <a-input-password v-model:value="editForm.password" :disabled="editLoading" aria-label="重设密码" v-bind="editFeedback.attrs('password')" placeholder="留空保持原密码，修改时至少 3 位" :maxlength="72" />
              <p v-if="editErrors.password" :id="editFeedback.errorId('password')" class="field-error">{{ editErrors.password }}</p>
            </a-form-item>
          </a-col>
        </a-row>
        <div class="form-section-title">角色权限</div>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="角色" data-form-field="roleId" :validate-status="editErrors.roleId ? 'error' : undefined">
              <a-select v-model:value="editForm.roleId" :disabled="editLoading" aria-label="角色" v-bind="editFeedback.attrs('roleId')" placeholder="选择角色" allow-clear style="width: 100%">
                <a-select-option v-for="r in allRoles" :key="r.id" :value="r.id">{{ r.name }}</a-select-option>
              </a-select>
              <p v-if="editErrors.roleId" :id="editFeedback.errorId('roleId')" class="field-error">{{ editErrors.roleId }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">

            <a-form-item label="附加角色" data-form-field="roleIds" :validate-status="editErrors.roleIds ? 'error' : undefined">
              <a-select v-model:value="editForm.roleIds" :disabled="editLoading" aria-label="附加角色" v-bind="editFeedback.attrs('roleIds')" mode="multiple" placeholder="可选多个" style="width: 100%">
                <a-select-option v-for="r in allRoles" :key="r.id" :value="r.id" :disabled="r.id === editForm.roleId">{{ r.name }}</a-select-option>
              </a-select>
              <p v-if="editErrors.roleIds" :id="editFeedback.errorId('roleIds')" class="field-error">{{ editErrors.roleIds }}</p>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
      </div>
    </a-modal>

    <a-modal
      v-model:open="scopeVisible"
      :confirm-loading="scopeSaving"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleScopeSave"
      width="900px"
    >
      <template #title>
        <div class="flex items-center gap-2">
          <SafetyOutlined class="text-primary" />
          <span>业务数据范围设置 - {{ scopeTarget?.name ?? '' }}</span>
        </div>
      </template>
      <div class="mb-2 text-sm text-[#646262]">
        未配置的表单继承「所有表单」的数据范围；选择「按用户 / 按部门」后需指定具体目标。
      </div>
      <a-table
        :columns="scopeColumns"
        :data-source="scopeRows"
        :loading="scopeLoading"
        :pagination="false"
        row-key="scopeKey"
        size="small"
        :scroll="{ y: 430 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'scopeType'">
            <div class="flex flex-col gap-1.5">
              <a-radio-group v-model:value="record.scopeType" size="small">
                <a-radio v-if="!record.isGlobal" value="">
                  <span class="text-[#646262]">继承</span>
                </a-radio>
                <a-radio value="self">自己的</a-radio>
                <a-radio value="all">全部</a-radio>
                <a-radio value="by_users">按用户</a-radio>
                <a-radio value="by_depts">按部门</a-radio>
              </a-radio-group>
              <a-select
                v-if="record.scopeType === 'by_users'"
                v-model:value="record.targets"
                mode="multiple"
                placeholder="选择用户"
                :options="scopeUserOptions"
                :max-tag-count="'responsive'"
                size="small"
                style="width: 100%"
                show-search
                option-filter-prop="label"
              />
              <a-select
                v-else-if="record.scopeType === 'by_depts'"
                v-model:value="record.targets"
                mode="multiple"
                placeholder="选择部门"
                :options="scopeDeptOptions"
                :max-tag-count="'responsive'"
                size="small"
                style="width: 100%"
                show-search
                option-filter-prop="label"
              />
            </div>
          </template>
          <template v-else-if="column.key === 'viewOthers' || column.key === 'editOthers' || column.key === 'deleteOthers'">
            <a-switch
              v-model:checked="record[column.key]"
              size="small"
              :disabled="!record.isGlobal && !record.scopeType"
            />
          </template>
        </template>
      </a-table>
    </a-modal>
      </div>
    </a-card>

    <div class="shrink-0 pr-4 ml-2.5 pt-2.5">
      <!-- 分页位于页脚；横滚条放在成员表格同宽区域，确保可拖至全部字段。 -->
      <ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, h, watch } from 'vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormFeedback } from '@/composables/useFormFeedback'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import StickyScrollBar from '@/components/StickyScrollBar.vue'
import ColumnSettings from '@/components/ColumnSettings.vue'
import { formatDate, withEmptyDash } from '@/utils/format'
import { message, Modal } from 'ant-design-vue'
import {
  getUsers, getUsersSimple, createUser,
  updateUser, toggleUserStatus, deleteUser,
  getUserDataScopes, saveUserDataScopes, getScopeForms, type ScopeFormMeta,
  type UserItem, type UserSimple,
} from '@/api/user'
import { getAllRoles, type RoleOption } from '@/api/role'
import { getDepartmentsAll, createDepartment, updateDepartment, deleteDepartment, type Department } from '@/api/department'
import { PlusOutlined, EditOutlined, DeleteOutlined, ApartmentOutlined, AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined, StopOutlined, CheckCircleOutlined, UserAddOutlined, MailOutlined, PhoneOutlined, IdcardOutlined, UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons-vue'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListQuery } from '@/composables/useListQuery'
import { filterDatePresets } from '@/utils/filter-dates'
import ListFilters from '@/components/ListFilters.vue'
import ListFooter from '@/components/ListFooter.vue'
import { useAppStore } from '@/stores/app'
import { useListPage } from '@/composables/useListPage'
import FilterViews from '@/components/FilterViews.vue'
import type { FilterViewPayload } from '@/components/FilterViews.vue'
import { searchOrgTree, collectOrgKeys, orgTreeHasKey, splitHighlight } from './org-tree-search'

// ============ 状态 ============
const appStore = useAppStore()

const allRoles = ref<RoleOption[]>([])
const allDepts = ref<Department[]>([])

const deptModalVisible = ref(false)
const deptModalLoading = ref(false)
const deptEditId = ref<number | null>(null)
const deptForm = reactive({ name: '', code: '', parentId: undefined as number | undefined, status: 1, sort: 0 })
/** 上级部门选项（组织架构树拉平，排除"全部成员"根） */
const deptOptionsFlat = computed(() => {
  const flat: { id: number; name: string }[] = []
  const walk = (list: any[]) => {
    for (const n of list) {
      if (n.id !== 'all') {
        flat.push({ id: n.id, name: n.name })
        if (n.children?.length) walk(n.children)
      }
    }
  }
  walk(orgTreeData.value)
  return flat
})

const deptFeedbackRoot = ref<HTMLElement | null>(null)
const deptFeedback = useFormFeedback({ root: deptFeedbackRoot, fields: () => ({ name: '部门名称', code: '部门编码' }), values: () => ({ name: deptForm.name, code: deptForm.code }) })
const { summary: deptFeedbackItems, requestId: deptRequestId, errors: deptErrors } = deptFeedback
let deptBaseline = ''
const deptUnsaved = useUnsavedChanges({
  active: () => deptModalVisible.value,
  dirty: () => JSON.stringify({ name: deptForm.name, code: deptForm.code, parentId: deptForm.parentId, sort: deptForm.sort, status: deptForm.status }) !== deptBaseline,
  saving: () => deptModalLoading.value,
})
function closeDeptModal() { void deptUnsaved.attempt(() => { deptModalVisible.value = false; deptFeedback.clear() }) }

function openDeptCreate(parent?: any) {
  deptEditId.value = null
  deptForm.name = ''
  deptForm.code = ''
  deptForm.parentId = parent?.id ?? undefined
  deptForm.status = 1
  deptForm.sort = 0
  deptFeedback.clear()
  deptBaseline = JSON.stringify({ name: deptForm.name, code: deptForm.code, parentId: deptForm.parentId, sort: deptForm.sort, status: deptForm.status })
  deptModalVisible.value = true
}

function openDeptEdit(node: any) {
  deptEditId.value = node.id
  const d = allDepts.value.find((x) => x.id === node.id)
  deptForm.name = d?.name ?? node.name ?? ''
  deptForm.code = d?.code ?? ''
  deptForm.parentId = d?.parentId ?? undefined
  deptForm.status = d?.status ?? 1
  deptForm.sort = d?.sort ?? 0
  deptFeedback.clear()
  deptBaseline = JSON.stringify({ name: deptForm.name, code: deptForm.code, parentId: deptForm.parentId, sort: deptForm.sort, status: deptForm.status })
  deptModalVisible.value = true
}

async function handleDeptSubmit() {
  if (deptModalLoading.value) return
  const localErrors: Record<string, string> = {}
  if (!deptForm.name.trim()) localErrors.name = '请输入部门名称'
  if (!deptEditId.value && !deptForm.code.trim()) localErrors.code = '请输入部门编码'
  if (!(await deptFeedback.validate(localErrors))) return
  deptModalLoading.value = true
  try {
    if (deptEditId.value) {
      await updateDepartment(deptEditId.value, { name: deptForm.name.trim(), parentId: deptForm.parentId ?? null, status: deptForm.status, sort: deptForm.sort }, { errorFeedback: 'form' })
    } else {
      await createDepartment({ name: deptForm.name.trim(), code: deptForm.code.trim(), parentId: deptForm.parentId ?? null, status: deptForm.status, sort: deptForm.sort }, { errorFeedback: 'form' })
    }
    message.success('保存成功')
    deptModalVisible.value = false
    refreshOrg()
  } catch (error) {
    await deptFeedback.capture(error)
  } finally {
    deptModalLoading.value = false
  }
}

async function handleDeptDelete(id: number) {
  try {
    await deleteDepartment(id)
    message.success('删除成功')
    refreshOrg()
  } catch { /* 拦截器已提示 */ }
}

/** 部门变更后刷新组织架构树 + 当前列表 */
function refreshOrg() {
  getDepartmentsAll()
    .then((list) => {
      allDepts.value = list
      loadOrgTree()
      fetchUsers()
    })
    .catch(() => { /* */ })
}

const orgPreference = localStorage.getItem('starter-org-collapsed')
const orgCollapsed = ref(orgPreference === '1' || (orgPreference === null && window.matchMedia('(max-width: 768px)').matches))
function toggleOrg() {
  orgCollapsed.value = !orgCollapsed.value
  localStorage.setItem('starter-org-collapsed', orgCollapsed.value ? '1' : '0')
}

const selectedDeptKey = ref<string[]>(['all'])
const orgTreeData = ref<any[]>([])
const deptCounts = ref<Record<number, number>>({})
const orgKeyword = ref('')
const orgExpandedKeys = ref<string[]>([])
let orgExpandSnapshot: string[] | null = null

function buildOrgTree(totalUsers: number) {
  const nodes = new Map<number, any>()
  for (const d of allDepts.value) {
    nodes.set(d.id, { id: d.id, key: `dept-${d.id}`, name: d.name, code: d.code, parentId: d.parentId, count: deptCounts.value[d.id] ?? 0, children: [] })
  }
  const roots: any[] = []
  for (const n of nodes.values()) {
    if (n.parentId != null && nodes.has(n.parentId)) nodes.get(n.parentId).children.push(n)
    else roots.push(n)
  }
  // 子部门人数递归累加（与"点部门看本部门及以下"口径一致）
  const accumulate = (n: any): number => {
    let c = n.count
    for (const ch of n.children) c += accumulate(ch)
    n.count = c
    return c
  }
  for (const r of roots) accumulate(r)
  return [{ key:'all', name:'全部成员', count:totalUsers, children:roots }]

}

/** 加载组织架构树（人数来自 getUsersSimple，零新接口） */
async function loadOrgTree() {
  try {
    const simple = await getUsersSimple()
    const direct: Record<number, number> = {}
    for (const u of simple) {
      if (u.deptId != null) direct[u.deptId] = (direct[u.deptId] ?? 0) + 1
    }
    deptCounts.value = direct
    orgTreeData.value = buildOrgTree(simple.length)
  } catch { /* 树失败不阻塞列表 */ }
}

// ============ 组织树搜索 ============
const orgTreeVisible = computed(() => searchOrgTree(orgTreeData.value, orgKeyword.value).visible)

// 搜索时自动展开祖先并保留进入搜索前的展开快照；清除搜索或部门增删重建树后按同一口径恢复
watch([orgKeyword, orgTreeData], () => {
  const active = !!orgKeyword.value.trim()
  if (active) {
    if (orgExpandSnapshot === null) orgExpandSnapshot = orgExpandedKeys.value
    const { expandKeys } = searchOrgTree(orgTreeData.value, orgKeyword.value)
    if (expandKeys.length) orgExpandedKeys.value = expandKeys
  } else {
    orgExpandedKeys.value = orgExpandSnapshot ?? collectOrgKeys(orgTreeData.value)
    orgExpandSnapshot = null
  }
})

function onOrgSearchEsc(event: KeyboardEvent) {
  if (event.isComposing) return
  if (orgKeyword.value) orgKeyword.value = ''
}

// 选中部门被搜索隐藏时列表仍按其过滤，明确提示并可一键回到全部成员，不静默切换
const orgSelectedHidden = computed(() => {
  const key = selectedDeptKey.value[0]
  if (!key || key === 'all' || !orgKeyword.value.trim()) return false
  return !orgTreeHasKey(orgTreeVisible.value, key)
})

const orgSelectedName = computed(() => {
  const key = selectedDeptKey.value[0]
  const id = key && key !== 'all' ? Number(String(key).replace('dept-', '')) : NaN
  return allDepts.value.find((d) => d.id === id)?.name ?? ''
})

function resetDeptSelection() {
  selectedDeptKey.value = ['all']
  applyDeptFilter(undefined)
}

function onSelectedTipClose(e: MouseEvent) {
  e.preventDefault()
  resetDeptSelection()
}

/** 树点击：全部成员 → 全量；部门 → 该部门及以下 */
function onTreeSelect(keys: any[]) {
  const key = keys?.[0]
  if (!key) return
  selectedDeptKey.value = [key]
  applyDeptFilter(key === 'all' ? undefined : Number(String(key).replace('dept-', '')))
}

/** 树选择属于明确查询动作；存在未提交输入时先确认，再随当前输入一并查询 */
function applyDeptFilter(deptId: number | undefined) {
  const run = () => {
    draft.value.deptId = deptId
    void apply()
  }
  if (dirty.value) {
    Modal.confirm({ title: '替换未查询的输入？', content: '选择部门会立即查询，尚未应用的输入将一并应用。', okText: '立即查询', cancelText: '保留输入', onOk: run })
  } else {
    run()
  }
}

// ============ 列宽拖拽 ============
const allColumns = ref(withEmptyDash([
  { title: '登录账号', dataIndex: 'username', key: 'username', width: 100 },
  { title: '姓名', dataIndex: 'displayName', key: 'displayName', width: 100 },
  { title: '手机号', dataIndex: 'phone', key: 'phone', width: 130 },
  { title: '邮箱', dataIndex: 'email', key: 'email', width: 160 },
  { title: '角色', key: 'role', width: 120 },
  { title: '是否管理员', key: 'isAdmin', width: 100, customRender: ({ record }: any) => {
    const isA = isSuperAdminUser(record)
    return h('span', { style: { color: isA ? '#187536' : '#646262' } }, isA ? '是' : '否')
  } },
  { title: '部门', key: 'dept', width: 100, customRender: ({ record }: any) => record.dept?.name || '-' },
  { title: '状态', key: 'status', width: 80 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, customRender: ({ text }: any) => formatDate(text) },
  { title: '操作', key: 'action', width: 110, fixed: 'right' as const },
]))
const columns = ref([...allColumns.value])
const { resizeStart, colWidths, setColumnWidth } = useResizableColumns('starter-cols-users-main-width', columns, {
  username: 100, displayName: 100, phone: 130, email: 160, role: 120, dept: 100, isAdmin: 100,
  status: 80, createdAt: 180, action: 110,
})

// ============ 数据获取（统一筛选 F01/F04） ============
interface UserFilters { keyword: string; statuses: number[]; created?: [string, string]; deptId?: number }
const userFilterDefaults = (): UserFilters => ({ keyword: '', statuses: [], created: undefined, deptId: undefined })
const userStatusOptions = [
  { label: '启用', value: 1 },
  { label: '停用', value: 0 },
]
const { setTableRef, stickySource } = useListPage()
const { draft, applied, dirty, loading, failed, rows: users, total, page, pageSize, sort, refresh: fetchUsers, apply, reset: resetFilters, changePage } = useListQuery<UserFilters, UserItem>({
  key: 'system-users', account: () => appStore.userInfo?.id,
  defaults: userFilterDefaults,
  normalize: query => ({ keyword: query.keyword.trim(), statuses: [...new Set(query.statuses)].sort(), created: query.created?.length === 2 ? [query.created[0], query.created[1]] : undefined, deptId: query.deptId }),
  load: (query, signal) => getUsers({
    page: query.page, pageSize: query.pageSize,
    keyword: query.keyword || undefined,
    status: query.statuses.join(',') || undefined,
    createdAtFrom: query.created?.[0], createdAtTo: query.created?.[1],
    deptId: query.deptId,
  }, signal),
  scrollElement: stickySource,
})

const deptNameById = computed(() => new Map(allDepts.value.map((d) => [d.id, d.name])))
const filterTags = computed(() => {
  const tags: { key: string; label: string }[] = []
  if (applied.value.deptId != null) tags.push({ key: 'deptId', label: `部门：${deptNameById.value.get(applied.value.deptId) ?? '#' + applied.value.deptId}` })
  if (applied.value.keyword) tags.push({ key: 'keyword', label: `关键词：${applied.value.keyword}` })
  if (applied.value.statuses.length) tags.push({ key: 'statuses', label: `状态：${applied.value.statuses.map((s) => (s === 1 ? '启用' : '停用')).join('、')}` })
  if (applied.value.created) tags.push({ key: 'created', label: `创建时间：${applied.value.created.join(' 至 ')}` })
  return tags
})
function removeFilter(key: string) {
  if (key === 'deptId') selectedDeptKey.value = ['all']
  void apply({ ...applied.value, [key]: key === 'keyword' ? '' : undefined })
}
function onSearchEnter(event: KeyboardEvent) { if (!event.isComposing && event.keyCode !== 229) void apply() }

/** 应用保存的视图：恢复条件与排序；字段已变化的给出失效提示 */
function onApplyView({ query, sort: viewSort, staleKeys, name }: FilterViewPayload) {
  if (staleKeys.length) message.warning(`视图「${name}」的字段已变化，已忽略：${staleKeys.join('、')}`)
  selectedDeptKey.value = query.deptId != null ? [`dept-${query.deptId}`] : ['all']
  sort.value = viewSort
  // 旧结构视图可能缺少新字段，用模块默认值补齐后再应用
  void apply({ ...userFilterDefaults(), ...query } as unknown as UserFilters)
}

const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
const totalText = computed(() => (count: number) => (failed.value ? '数量暂不可用' : loading.value ? '查询中…' : `共 ${count} 条`))
/** 查询重置回基准条件与第一页，组织树选中同步回到"全部成员" */
function onFiltersReset() {
  selectedDeptKey.value = ['all']
  resetFilters()
}
const appliedRecord = computed(() => ({ ...applied.value }) as Record<string, unknown>)
const widthsEditable = computed(() => ({ values: colWidths, apply: (key: string, width: number) => setColumnWidth(key, width) }))
function refreshUserViews() { return Promise.all([fetchUsers(), loadOrgTree()]) }

async function fetchRoles() {
  try {
    allRoles.value = await getAllRoles()
    if (!allRoles.value.length) {
      message.warning('角色列表为空或加载失败，请刷新页面重试')
    }
  } catch {
    allRoles.value = []
    message.error('角色列表加载失败，请刷新页面重试')
  }
}

// ============ 新增 ============
const createVisible = ref(false)
const createLoading = ref(false)
const leaderOptions = ref<UserSimple[]>([])
function loadLeaderOptions() {
  getUsersSimple().then((rows) => { leaderOptions.value = rows }).catch(() => {})
}
const createForm = reactive({
  loginid: '',
  displayName: '',
  password: '',
  email: '',
  phone: '',
  roleId: undefined as number | undefined,
  roleIds: [] as number[],
  deptId: undefined as number | undefined,
  leaderId: undefined as number | undefined,
})
const createFeedbackRoot = ref<HTMLElement | null>(null)
const createFeedback = useFormFeedback({ root: createFeedbackRoot, fields: () => ({ loginid: '登录账号', displayName: '姓名', password: '初始密码', email: '邮箱', phone: '手机号', deptId: '部门', leaderId: '直属上级', roleId: '角色', roleIds: '附加角色' }), values: () => ({ ...createForm }) })
const { errors: createErrors, summary: createFeedbackItems, requestId: createRequestId } = createFeedback
const createBaseline = ref('')
const createUnsaved = useUnsavedChanges({ active: () => createVisible.value, dirty: () => JSON.stringify(createForm) !== createBaseline.value, saving: () => createLoading.value })
function closeCreate() { void createUnsaved.attempt(() => { createVisible.value = false }) }
watch(createVisible, open => { if (!open) { createForm.password = ''; createFeedback.clear() } })

function showCreateModal() {
  if (createVisible.value) return
  createForm.loginid = ''
  createForm.displayName = ''
  createForm.password = ''
  createForm.email = ''
  createForm.phone = ''
  createForm.roleId = undefined
  createForm.deptId = undefined
  createForm.roleIds = []
  createForm.leaderId = undefined
  loadLeaderOptions()
  createVisible.value = true
  createBaseline.value = JSON.stringify(createForm)
  createFeedback.clear()
}

async function handleCreate() {
  if (createLoading.value) return
  const errors: Record<string, string> = {}
  if (!createForm.loginid.trim()) errors.loginid = '请输入登录账号'
  if (!createForm.displayName.trim()) errors.displayName = '请填写姓名'
  if (Array.from(createForm.password).length < 3) errors.password = '请设置至少 3 位的初始密码'
  else if (new TextEncoder().encode(createForm.password).length > 72) errors.password = '密码最多 72 字节'
  if (createForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email.trim())) errors.email = '请输入有效的邮箱地址'
  else if (createForm.email.length > 100) errors.email = '邮箱不能超过 100 字'
  if (createForm.phone.length > 20) errors.phone = '手机号不能超过 20 字'
  if (!(await createFeedback.validate(errors))) return
  createLoading.value = true
  try {
    await createUser({
      loginid: createForm.loginid.trim(),
      displayName: createForm.displayName.trim(),
      password: createForm.password,
      email: createForm.email || undefined,
      phone: createForm.phone || undefined,
      roleId: createForm.roleId,
      roleIds: createForm.roleIds.length ? createForm.roleIds : undefined,
      deptId: createForm.deptId,
      leaderId: createForm.leaderId ?? undefined,
    }, { errorFeedback: 'form' })
    message.success('新增成功')
    createVisible.value = false
    void refreshUserViews()
  } catch (error) { await createFeedback.capture(error) }
  finally { createLoading.value = false }
}

// ============ 编辑 ============
const editVisible = ref(false)
const editLoading = ref(false)
const editForm = reactive({ id: 0, password: '', username: '', displayName: '', email: '', phone: '', roleId: undefined as number | undefined, roleIds: [] as number[], deptId: undefined as number | undefined, leaderId: undefined as number | undefined, _origLeaderId: undefined as number | undefined })
const editFeedbackRoot = ref<HTMLElement | null>(null)
const editFeedback = useFormFeedback({ root: editFeedbackRoot, fields: () => ({ displayName: '姓名', email: '邮箱', phone: '手机号', password: '重设密码', deptId: '部门', leaderId: '直属上级', roleId: '角色', roleIds: '附加角色' }), values: () => ({ ...editForm }) })
const { summary: editFeedbackItems, requestId: editRequestId, errors: editErrors } = editFeedback
let editBaseline = ''
const editUnsaved = useUnsavedChanges({ active: () => editVisible.value, dirty: () => JSON.stringify({ ...editForm }) !== editBaseline, saving: () => editLoading.value })
function closeEdit() { void editUnsaved.attempt(() => { editVisible.value = false; editFeedback.clear() }) }

function showEditModal(record: any) {
  editForm.id = record.id
  editForm.password = ''
  editForm.username = record.username
  editForm.displayName = record.displayName || ''
  editForm.email = record.email || ''
  editForm.phone = record.phone || ''
  editForm.roleId = record.role?.id
  editForm.roleIds = (record.roleIds ?? []).filter((x: number) => x !== record.role?.id)
  editForm.deptId = record.deptId ?? undefined
  editForm.leaderId = record.leaderId ?? undefined
  editForm._origLeaderId = record.leaderId ?? undefined
  loadLeaderOptions()
  editFeedback.clear()
  editBaseline = JSON.stringify({ ...editForm })
  editVisible.value = true
}

async function handleEdit() {
  if (editLoading.value) return
  const localErrors: Record<string, string> = {}
  if (editForm.password && editForm.password.length < 3) localErrors.password = '密码至少 3 位'
  if (!(await editFeedback.validate(localErrors))) return
  editLoading.value = true
  try {
    const leaderChanged = editForm.leaderId !== editForm._origLeaderId
    await updateUser(editForm.id, {
      email: editForm.email || undefined,
      phone: editForm.phone || undefined,
      roleId: editForm.roleId ?? null,
      password: editForm.password || undefined,
      roleIds: editForm.roleIds,
      displayName: editForm.displayName || undefined,
      deptId: editForm.deptId ?? null,
      ...(leaderChanged ? { leaderId: editForm.leaderId ?? null } : {}),
    }, { errorFeedback: 'form' })
    message.success('保存成功')
    editVisible.value = false
    void refreshUserViews()
  } catch (error) {
    await editFeedback.capture(error)
  } finally { editLoading.value = false }
}

// ============ 删除 ============
async function handleDelete(id: number) {
  try {
    await deleteUser(id)
    message.success('删除成功')
    void refreshUserViews()
  } catch { /* */ }
}

// ============ 启用/禁用 ============
async function handleToggleStatus(record: any) {
  try {
    const res = await toggleUserStatus(record.id)
    message.success(res.status === 1 ? '已启用' : '已禁用')
    void refreshUserViews()
  } catch { /* */ }
}

/** 可配置表单清单（唯一真相源：后端 scope-form.registry 下发，前端不硬编码） */
const SCOPE_FORM_META = ref<ScopeFormMeta[]>([])

/** 矩阵行：scopeType 为空 = 继承「所有表单」（保存时该行省略，后端全量替换即删除旧配置） */
interface ScopeRow {
  scopeKey: string
  label: string
  isGlobal: boolean
  scopeType: string
  viewOthers: boolean
  editOthers: boolean
  deleteOthers: boolean
  targets: number[]
}

const scopeVisible = ref(false)
const scopeLoading = ref(false)
const scopeSaving = ref(false)
const scopeTarget = ref<{ id: number; name: string } | null>(null)
const scopeRows = ref<ScopeRow[]>([])
const scopeUsers = ref<UserSimple[]>([])
const scopeDepts = ref<Department[]>([])

const scopeColumns = withEmptyDash([
  { title: '表单', dataIndex: 'label', key: 'label', width: 130 },
  { title: '数据范围', key: 'scopeType', width: 400 },
  { title: '查看他人详情', key: 'viewOthers', width: 96, align: 'center' as const },
  { title: '编辑他人', key: 'editOthers', width: 90, align: 'center' as const },
  { title: '删除他人', key: 'deleteOthers', width: 90, align: 'center' as const },
])

const scopeUserOptions = computed(() =>
  scopeUsers.value.map((u) => ({ value: u.id, label: u.displayName || u.username })),
)
const scopeDeptOptions = computed(() =>
  scopeDepts.value.map((d) => ({ value: d.id, label: d.name })),
)

/** admin 角色 id（主角色或附加角色命中即视为超级管理员） */
const adminRoleIds = computed(() => allRoles.value.filter((r) => r.code === 'admin').map((r) => r.id))

/** 目标用户是否超级管理员（拥有全部数据权限，不显示设置入口） */
function isSuperAdminUser(record: any): boolean {
  if (record.role?.code === 'admin') return true
  return (record.roleIds ?? []).some((id: number) => adminRoleIds.value.includes(id))
}

function openDataScope(record: any) {
  scopeTarget.value = { id: record.id, name: record.displayName || record.username }
  scopeRows.value = [
    { scopeKey: '__global__', label: '所有表单', isGlobal: true, scopeType: 'self', viewOthers: true, editOthers: false, deleteOthers: false, targets: [] },
    ...SCOPE_FORM_META.value.map((m) => ({ scopeKey: m.scopeKey, label: m.label, isGlobal: false, scopeType: '', viewOthers: false, editOthers: false, deleteOthers: false, targets: [] })),
  ]
  scopeVisible.value = true
  scopeLoading.value = true
  Promise.all([getUserDataScopes(record.id), getUsersSimple(), getDepartmentsAll()])
    .then(([list, users, depts]) => {
      scopeUsers.value = users
      scopeDepts.value = depts
      // 回显：GET 只返回用户实际配置过的行，未返回的表单保持「继承」
      for (const item of list) {
        const row = scopeRows.value.find((r) => r.scopeKey === item.scopeKey)
        if (!row) continue
        row.scopeType = item.scopeType || ''
        row.viewOthers = item.viewOthers === 1
        row.editOthers = item.editOthers === 1
        row.deleteOthers = item.deleteOthers === 1
        row.targets = Array.isArray(item.targets) ? item.targets : []
      }
    })
    .catch(() => { /* request 拦截器已提示 */ })
    .finally(() => { scopeLoading.value = false })
}

function handleScopeSave() {
  if (!scopeTarget.value) return
  // 收集全部行：scopeType 为空（继承）的行直接省略（全量替换）
  const rows = scopeRows.value
    .filter((r) => r.scopeType)
    .map((r) => ({
      scopeKey: r.scopeKey,
      scopeType: r.scopeType,
      viewOthers: r.viewOthers ? 1 : 0,
      editOthers: r.editOthers ? 1 : 0,
      deleteOthers: r.deleteOthers ? 1 : 0,
      targets: r.targets,
    }))
  scopeSaving.value = true
  saveUserDataScopes(scopeTarget.value.id, rows)
    .then(() => {
      message.success('数据范围已保存，该用户需重新登录生效')
      scopeVisible.value = false
    })
    .catch(() => { /* request 拦截器已提示 */ })
    .finally(() => { scopeSaving.value = false })
}

// ============ 初始化 ============
onMounted(() => {
  void getScopeForms().then((list) => { SCOPE_FORM_META.value = list || [] }).catch(() => { /* 请求拦截器已提示 */ })
  fetchUsers()
  fetchRoles()
  getDepartmentsAll()
    .then((list) => {
      allDepts.value = list
      loadOrgTree()
    })
    .catch(() => { /* */ })
})
</script>

<style scoped>

.org-hit {
  background: var(--color-layer-hover);
  color: var(--color-text-primary);
  font-weight: 600;
  border-radius: 2px;
  padding: 0 1px;
}
.org-search-empty {
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
}
.org-selected-tip {
  max-width: 100%;
  white-space: normal;
  word-break: break-all;
}

.field-error { margin: 4px 0 0; color: #b42318; }
.form-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #646262;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

:deep(.ant-btn .anticon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 1em;
  line-height: 1;
}

:deep(.ant-tabs-nav-list) {
  margin-left: 15px;
}

:deep(.ant-card) {
  display: flex;
  flex-direction: column;
}
:deep(.ant-card-body) {
  flex: 1;
  min-height: 0;
  display: flex;

  flex-direction: row;
}

@media (max-width: 768px) {
  .users-card :deep(.ant-card-body) {
    flex-direction: column;
  }

  .org-panel {
    width: 100%;
    max-height: min(35vh, 220px);
    border-right: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .org-panel--collapsed {
    flex-direction: row;
    gap: 8px;
    padding: 8px 12px;
  }

  .org-panel--collapsed .org-panel-label {
    margin-top: 0;
    writing-mode: horizontal-tb;
    letter-spacing: normal;
  }
}

:deep(.ant-table-content) {
  scrollbar-width: none;
}
:deep(.ant-table-content::-webkit-scrollbar) {
  display: none;
  height: 0;
}

:deep(.ant-table-body) {
  scrollbar-width: none;
}
:deep(.ant-table-body::-webkit-scrollbar) {
  display: none;
  height: 0;
}

:deep(.ant-table-sticky-scroll) {
  scrollbar-width: none;
}
:deep(.ant-table-sticky-scroll::-webkit-scrollbar) {
  display: none;
  height: 0;
}
</style>
