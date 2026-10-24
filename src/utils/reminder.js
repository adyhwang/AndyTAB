/**
 * 待办提醒规则：一次性 / 倒计时 / 周期循环
 *
 * 规则结构（保存在 todo.remindRule）：
 *   { mode: 'once' }
 *   { mode: 'countdown', duration: { d, h, m, s } }
 *   { mode: 'cycle', unit: 'week',  weekday: 1-7, hour, minute, second }
 *   { mode: 'cycle', unit: 'month', day: 1-31,   hour, minute, second }
 *   { mode: 'cycle', unit: 'year',  month: 1-12, day: 1-31, hour, minute, second }
 *
 * todo.remindAt 始终保存下一次触发的绝对时间戳，供 alarm 与列表展示使用。
 */

export function isRepeatingReminder(rule) {
    return !!rule && (rule.mode === 'cycle' || (rule.mode === 'countdown' && !!rule.repeat));
}

function durationToSeconds(duration = {}) {
    return (duration.d || 0) * 86400 + (duration.h || 0) * 3600
        + (duration.m || 0) * 60 + (duration.s || 0);
}


function pad(n, length = 2) {
    return String(n).padStart(length, '0');
}

/**
 * 计算周期提醒的下一次触发时间
 * @param {object} rule 周期规则
 * @param {number} from 起点时间戳，默认当前时间
 * @returns {number|null} 下一次触发时间戳
 */
export function computeNextOccurrence(rule, from = Date.now()) {
    if (!isRepeatingReminder(rule)) return null;

    // 循环倒计时：按同一时长从本次触发时间继续顺延
    if (rule.mode === 'countdown') {
        const seconds = durationToSeconds(rule.duration);
        return seconds > 0 ? from + seconds * 1000 : null;
    }

    const base = new Date(from);
    const hour = rule.hour || 0;
    const minute = rule.minute || 0;
    const second = rule.second || 0;

    if (rule.unit === 'week') {
        const todayWeekday = ((base.getDay() + 6) % 7) + 1; // 1=周一 … 7=周日
        const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, second, 0);
        const delta = ((rule.weekday || 1) - todayWeekday + 7) % 7;
        target.setDate(target.getDate() + delta);
        if (target.getTime() <= from) target.setDate(target.getDate() + 7);
        return target.getTime();
    }

    if (rule.unit === 'month') {
        for (let offset = 0; offset < 24; offset++) {
            const year = base.getFullYear();
            const month = base.getMonth() + offset;
            // 该月不存在的日期（如 2 月 30 日）自动落到月末
            const lastDay = new Date(year, month + 1, 0).getDate();
            const day = Math.min(rule.day || 1, lastDay);
            const target = new Date(year, month, day, hour, minute, second, 0);
            if (target.getTime() > from) return target.getTime();
        }
        return null;
    }

    if (rule.unit === 'year') {
        for (let offset = 0; offset < 8; offset++) {
            const year = base.getFullYear() + offset;
            const month = (rule.month || 1) - 1;
            const lastDay = new Date(year, month + 1, 0).getDate();
            const day = Math.min(rule.day || 1, lastDay);
            const target = new Date(year, month, day, hour, minute, second, 0);
            if (target.getTime() > from) return target.getTime();
        }
        return null;
    }

    return null;
}

/** 将时分秒格式化为 HH:MM:SS，供 time 输入框使用 */
export function toTimeValue(hour = 0, minute = 0, second = 0) {
    return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** 解析 HH:MM:SS，缺省部分按 0 处理 */
export function parseTimeValue(value) {
    const parts = String(value || '').split(':');
    return {
        hour: parseInt(parts[0], 10) || 0,
        minute: parseInt(parts[1], 10) || 0,
        second: parseInt(parts[2], 10) || 0
    };
}

export function weekdayLabel(weekday) {
    return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][(weekday || 1) - 1];
}
